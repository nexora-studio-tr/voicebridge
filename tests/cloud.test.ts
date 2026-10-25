import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { CloudEngine, OpenAITransport, type CloudTransport } from '../src/server/cloud.js';
import { Store } from '../src/core/store.js';
import { ProviderConfig } from '../src/core/contracts.js';
import { temporary, voice, signal } from './helpers.js';
const config = () =>
  ProviderConfig.parse({
    kind: 'openai',
    key: 'test-not-a-real-api-key',
    recognition: 'gpt-transcribe',
    translation: 'gpt-realtime-2.1-mini',
    speech: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    prices: {
      asrPerMinute: 4500,
      inputPerMillion: 600000,
      outputPerMillion: 2400000,
      ttsPerMillion: 20000000,
      verifiedAt: new Date().toISOString(),
    },
  });
describe('budgeted cloud calls with no paid network traffic', () => {
  let dir: ReturnType<typeof temporary>, store: Store, transport: CloudTransport, active: boolean;
  beforeEach(() => {
    dir = temporary();
    store = new Store(dir.root);
    store.setPolicy('g', {
      enabled: true,
      daily: 100_000,
      monthly: 500_000,
      room: 100_000,
      user: 100_000,
    });
    active = true;
    transport = {
      recognize: vi.fn(async () => 'Hello'),
      realtime: vi.fn(async () => ({
        text: 'Merhaba',
        audio: Buffer.alloc(4800),
        usage: { input_tokens: 10, output_tokens: 20 },
      })),
    };
  });
  afterEach(() => {
    store.close();
    dir.remove();
  });
  const context = () => ({
    operation: 'utterance',
    guildId: 'g',
    roomId: 'r',
    actorId: 'a',
    valid: () => active,
  });
  it('reserves before transport dispatch and refuses insufficient budget', async () => {
    store.setPolicy('g', { enabled: true, daily: 1, monthly: 1, room: 1, user: 1 });
    const e = new CloudEngine(store, config(), context(), transport);
    await expect(e.recognize(voice(), 'en', signal())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(transport.recognize).not.toHaveBeenCalled();
  });
  it('does not retry a provider failure or refund potentially billed work', async () => {
    transport.recognize = vi.fn(async () => {
      throw new Error('timeout');
    });
    const e = new CloudEngine(store, config(), context(), transport);
    await expect(e.recognize(voice(), 'en', signal())).rejects.toThrow('timeout');
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(store.summary('g')).toMatchObject({ daily: 4500, uncertain: 1 });
  });
  it('cancels before spending when consent or listener membership is invalid', async () => {
    active = false;
    await expect(
      new CloudEngine(store, config(), context(), transport).speak('Hi', 'en', signal()),
    ).rejects.toThrow('CANCELED');
    expect(store.summary('g').daily).toBe(0);
    expect(transport.realtime).not.toHaveBeenCalled();
  });
  it('requires recent explicit price review', async () => {
    const cfg = config();
    cfg.prices.verifiedAt = '2020-01-01T00:00:00Z';
    await expect(
      new CloudEngine(store, cfg, context(), transport).recognize(voice(), 'en', signal()),
    ).rejects.toThrow('PRICE_REVIEW_REQUIRED');
    expect(transport.recognize).not.toHaveBeenCalled();
  });
  it('settles translation usage and wraps bounded PCM speech as a WAV', async () => {
    const e = new CloudEngine(store, config(), context(), transport);
    expect(await e.translate('Hello', 'en', 'tr', signal())).toBe('Merhaba');
    const translatedCost = store.summary('g').daily;
    expect(translatedCost).toBe(54);
    const speech = await e.speak('Merhaba', 'tr', signal());
    expect(speech.toString('ascii', 0, 4)).toBe('RIFF');
    expect(store.summary('g').daily).toBe(translatedCost + 406);
    expect(store.summary('g').uncertain).toBe(0);
  });
});
describe('OpenAI wire protocol simulated locally', () => {
  class Socket extends EventEmitter {
    sent: Record<string, unknown>[] = [];
    close = vi.fn();
    send(raw: string) {
      this.sent.push(JSON.parse(raw));
    }
    event(value: unknown) {
      this.emit('message', Buffer.from(JSON.stringify(value)));
    }
  }
  it('uses a server-side websocket key and configures text translation before creating a response', async () => {
    const ws = new Socket(),
      factory = vi.fn<(url: string, options: WebSocket.ClientOptions) => WebSocket>(
        () => ws as unknown as WebSocket,
      ),
      transport = new OpenAITransport(factory);
    const promise = transport.realtime(
      'private-key',
      'gpt-realtime-2.1-mini',
      'marin',
      'Translate only.',
      'Hello',
      false,
      512,
      signal(),
    );
    ws.event({ type: 'session.created' });
    expect(ws.sent[0]).toMatchObject({
      type: 'session.update',
      session: { type: 'realtime', output_modalities: ['text'] },
    });
    ws.event({ type: 'session.updated' });
    expect(ws.sent[2]).toMatchObject({
      type: 'response.create',
      response: { max_output_tokens: 512 },
    });
    ws.event({ type: 'response.output_text.delta', delta: 'Merhaba' });
    ws.event({
      type: 'response.done',
      response: { status: 'completed', usage: { input_tokens: 2, output_tokens: 3 } },
    });
    expect((await promise).text).toBe('Merhaba');
    expect(factory.mock.calls[0]?.[0]).toContain('wss://api.openai.com/');
    expect(ws.sent).not.toContainEqual(expect.objectContaining({ key: 'private-key' }));
  });
  it('bounds audio output and propagates cancellation without waiting for a provider response', async () => {
    const ws = new Socket(),
      abort = new AbortController(),
      transport = new OpenAITransport(() => ws as unknown as WebSocket);
    const promise = transport.realtime(
      'private',
      'model',
      'marin',
      'Read',
      'text',
      true,
      1024,
      abort.signal,
    );
    abort.abort();
    await expect(promise).rejects.toThrow('CANCELED');
    expect(ws.close).toHaveBeenCalled();
  });
  it('rejects incomplete responses and oversized audio', async () => {
    const ws = new Socket(),
      transport = new OpenAITransport(() => ws as unknown as WebSocket),
      promise = transport.realtime(
        'private',
        'model',
        'marin',
        'Read',
        'text',
        true,
        1024,
        signal(),
      );
    ws.event({
      type: 'response.output_audio.delta',
      delta: Buffer.alloc(960002).toString('base64'),
    });
    await expect(promise).rejects.toThrow('PROVIDER_RESPONSE_LIMIT');
  });
  it('posts a bounded WAV for ASR and rejects a chunked oversized response', async () => {
    const request = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ text: 'Hello' })),
      ),
      transport = new OpenAITransport(undefined, request);
    expect(await transport.recognize('private', 'gpt-transcribe', voice(), 'en', signal())).toBe(
      'Hello',
    );
    const form = request.mock.calls[0]![1]!.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.get('language')).toBe('en');
    request.mockResolvedValueOnce(new Response('x'.repeat(100001)));
    await expect(
      transport.recognize('private', 'gpt-transcribe', voice(), 'en', signal()),
    ).rejects.toThrow('PROVIDER_RESPONSE_LIMIT');
  });
});
