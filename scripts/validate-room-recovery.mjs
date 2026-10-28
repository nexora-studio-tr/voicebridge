import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../dist/server/app.js';
import { wav } from '../dist/core/audio.js';
import { root } from './runtime.mjs';

/** Two independent browser contexts and real HTTP/SSE; synthetic identities/inference only. */
export async function validateRoomRecovery(browser, out) {
  const data = mkdtempSync(path.join(out, 'recovery-'));
  const origin = 'http://127.0.0.1:4392',
    guildId = '111111111111111111',
    channelId = '222222222222222222';
  const members = new Set(['alice', 'bob', 'speaker-one', 'speaker-two']);
  const gateway = {
    ready: () => true,
    status: () => ({ connected: true, configured: true, error: null }),
    start: async () => {
      throw Error('Synthetic fixture cannot connect Discord');
    },
    stop: () => {},
    member: async (guild, id) =>
      guild === guildId && members.has(id)
        ? {
            id,
            name: 'Synthetic ' + id,
            guildId,
            guildName: 'Synthetic recovery fixture',
            channelId,
            channelName: 'Recovery fixture',
            admin: false,
          }
        : null,
    allowed: (room, id) =>
      room.guildId === guildId && room.channelId === channelId && members.has(id),
  };
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2);
  const audio = wav(pcm);
  let utterance = 0,
    holdNextSpeech = false,
    releaseSpeech;
  const service = await createServer({
    root,
    dataDir: data,
    origin,
    gateway,
    local: {
      recognize: async () => 'Synthetic utterance ' + ++utterance,
      translate: async (text, _from, to) => to + ': ' + text,
      speak: async () => {
        if (holdNextSpeech) {
          holdNextSpeech = false;
          await new Promise((resolve) => {
            releaseSpeech = resolve;
          });
        }
        return audio;
      },
    },
  });
  const connections = new Map();
  service.app.server.on('request', (request, response) => {
    if (!request.url?.endsWith('/events')) return;
    for (const [id, session] of sessions)
      if (request.headers.cookie?.includes(session.id)) connections.set(id, response);
  });
  const sessions = new Map(
    ['alice', 'bob'].map((id) => [
      id,
      service.store.createSession({ id, name: 'Synthetic ' + id, operator: false }),
    ]),
  );
  const room = service.rooms.create(
    guildId,
    'Synthetic recovery fixture',
    channelId,
    'Recovery fixture',
    'speaker-one',
  );
  for (const id of ['speaker-one', 'speaker-two']) {
    service.rooms.addSpeaker(room, id, 'Synthetic ' + id);
    service.rooms.consent(room, id, { local: true, cloud: false, language: 'en' });
  }
  for (const id of ['alice', 'bob']) service.rooms.join(room, id, 'Synthetic ' + id);
  service.rooms.preferences(room, 'alice', { language: 'en', mode: 'local', audio: false });
  service.rooms.preferences(room, 'bob', { language: 'tr', mode: 'local', audio: false });
  let aliceContext, bobContext;
  const checks = [],
    errors = [],
    audioRequests = [];
  try {
    await service.app.listen({ host: '127.0.0.1', port: 4392 });
    async function open(id, locale) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'reduce',
      });
      await context.addInitScript((locale) => localStorage.setItem('vb-language', locale), locale);
      await context.addCookies([
        {
          name: 'vb-session',
          value: sessions.get(id).id,
          url: origin,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      await expect(page.locator('.connection')).toContainText(
        locale === 'en' ? 'Connected to room' : 'Odaya bağlı',
      );
      return { context, page };
    }
    const alice = await open('alice', 'en');
    aliceContext = alice.context;
    const bob = await open('bob', 'tr');
    bobContext = bob.context;
    const requests = [];
    alice.page.on('request', (request) => {
      requests.push(request.url());
      if (request.url().includes('/audio/')) audioRequests.push(request.url());
    });
    bob.page.on('request', (request) => requests.push(request.url()));
    let releasePreferenceAck;
    let preferenceSaved;
    const saved = new Promise((resolve) => {
      preferenceSaved = resolve;
    });
    await alice.page.route('**/preferences', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const response = await route.fetch();
      preferenceSaved();
      await new Promise((resolve) => {
        releasePreferenceAck = resolve;
      });
      await route.fulfill({ response });
    });
    await alice.page.getByRole('button', { name: 'Enable audio', exact: true }).click();
    await saved;
    await expect.poll(() => room.listeners.get('alice').preferences.audio).toBe(true);
    service.rooms.ingest(room, 'speaker-one', audio);
    await expect(alice.page.locator('.translation')).toContainText('Synthetic utterance 1');
    await expect(bob.page.locator('.translation')).toContainText('tr: Synthetic utterance 1');
    await expect.poll(() => audioRequests.length).toBe(1);
    releasePreferenceAck();
    await expect(
      alice.page.getByRole('button', { name: 'Stop listening', exact: true }),
    ).toBeEnabled();
    await expect(alice.page.locator('.translation')).toContainText('Synthetic utterance 1');
    await alice.page.unroute('**/preferences');
    const firstAudio = audioRequests[0];
    checks.push(
      'Two authenticated browser contexts receive independent English/Turkish captions and opt-in audio',
    );
    checks.push(
      'A preference acknowledgement delayed behind a live caption cannot erase newer stream content',
    );

    function loseNextAliceCaption() {
      const stream = connections.get('alice');
      expect(stream).toBeTruthy();
      const write = stream.write;
      let drop = true;
      stream.write = function (chunk, ...args) {
        if (
          drop &&
          String(chunk).startsWith('data: ') &&
          JSON.parse(String(chunk).slice(6)).type === 'caption'
        ) {
          drop = false;
          queueMicrotask(() => this.destroy());
          return true;
        }
        return write.call(this, chunk, ...args);
      };
    }
    loseNextAliceCaption();
    service.rooms.ingest(room, 'speaker-one', audio);
    await expect(bob.page.locator('.caption')).toHaveCount(2);
    await expect(alice.page.locator('.connection')).toContainText('Connected to room');
    await expect(alice.page.locator('.caption')).toHaveCount(2, { timeout: 10000 });
    expect(audioRequests).toHaveLength(1);
    checks.push(
      'A deliberately lost SSE caption is recovered from the authorized cache; buffered audio is not replayed',
    );

    loseNextAliceCaption();
    holdNextSpeech = true;
    service.rooms.ingest(room, 'speaker-one', audio);
    await expect.poll(() => typeof releaseSpeech).toBe('function');
    await expect(alice.page.locator('.caption')).toHaveCount(3, { timeout: 10000 });
    releaseSpeech();
    releaseSpeech = undefined;
    await expect.poll(() => room.jobs.size).toBe(0);
    await expect.poll(() => room.listeners.get('alice').captions.at(-1)?.audioUrl).toBeTruthy();
    expect(audioRequests).toHaveLength(1);
    service.rooms.ingest(room, 'speaker-two', audio);
    await expect(alice.page.locator('.caption')).toHaveCount(4);
    await expect.poll(() => room.listeners.get('alice').captions.at(-1)?.audioUrl).toBeTruthy();
    const newLiveAudio = origin + room.listeners.get('alice').captions.at(-1).audioUrl;
    await expect.poll(() => audioRequests.includes(newLiveAudio)).toBe(true);
    expect(audioRequests).toEqual([firstAudio, newLiveAudio]);
    checks.push(
      'A late TTS update for a caption restored during reconnect stays silent; a new live caption can play',
    );

    await aliceContext.setOffline(true);
    await expect(alice.page.locator('.connection')).toContainText('Reconnecting');
    await expect(alice.page.locator('.caption')).toHaveCount(0);
    await expect(alice.page.getByRole('button', { name: 'Retry now', exact: true })).toBeVisible();
    await alice.page.screenshot({
      path: path.join(out, 'room-reconnecting-en.png'),
      fullPage: true,
    });
    const axe = await new AxeBuilder({ page: alice.page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    service.rooms.consent(room, 'speaker-one', { local: false, cloud: false, language: 'en' });
    await expect(bob.page.locator('.caption')).toHaveCount(1);
    await aliceContext.setOffline(false);
    await expect(alice.page.locator('.connection')).toContainText('Connected to room', {
      timeout: 10000,
    });
    await expect(alice.page.locator('.caption')).toHaveCount(1);
    await expect(alice.page.locator('.translation')).toContainText('Synthetic utterance 4');
    expect(audioRequests).toHaveLength(2);
    checks.push(
      'Offline clears captions/queued audio; revocation during the outage stays removed after reconnect, with automatic WCAG A/AA checks',
    );

    const cookieName = 'vb-session';
    async function requestAs(id, url) {
      return fetch(origin + url, { headers: { cookie: cookieName + '=' + sessions.get(id).id } });
    }
    const bobOwnClip = room.listeners.get('bob').captions.at(-1);
    const aliceClip = room.listeners.get('alice').captions.at(-1);
    expect(bobOwnClip.audioUrl).toBeUndefined();
    expect((await requestAs('bob', aliceClip.audioUrl)).status).toBe(404);
    checks.push('The other listener cannot fetch an audio clip that was generated only for Alice');

    members.delete('alice');
    service.rooms.leave(room, 'alice');
    await expect(alice.page.locator('.people .person')).toHaveCount(0);
    await expect(alice.page.locator('.caption')).toHaveCount(0);
    await expect(
      alice.page.getByRole('button', { name: 'Stop listening', exact: true }),
    ).toHaveCount(0);
    await expect(
      alice.page.getByRole('button', { name: 'Enable audio', exact: true }),
    ).toBeDisabled();
    expect((await requestAs('alice', aliceClip.audioUrl)).status).toBe(403);
    service.rooms.ingest(room, 'speaker-two', audio);
    await expect(bob.page.locator('.caption')).toHaveCount(2);
    checks.push(
      'Membership loss ends Alice’s stream and audio access while Bob continues receiving new captions',
    );
    service.rooms.leave(room, 'speaker-two');
    members.delete('speaker-two');
    await expect(bob.page.locator('.caption')).toHaveCount(0);
    await bob.page.screenshot({ path: path.join(out, 'room-recovery-tr.png'), fullPage: true });
    checks.push('A departed speaker is removed from the remaining listener’s cached captions');
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
    checks.push(
      'No browser script errors, external requests, Discord login, model inference or billable provider calls',
    );
    writeFileSync(
      path.join(out, 'room-recovery-report.json'),
      JSON.stringify(
        {
          status: 'passed',
          checks,
          fixture: 'synthetic identities and inference; real HTTP/SSE and two Chromium contexts',
          liveDiscord: false,
          humanParticipants: 0,
          paidApi: false,
          capacityClaim: false,
        },
        null,
        2,
      ) + '\n',
    );
    return checks;
  } finally {
    releaseSpeech?.();
    await aliceContext?.close();
    await bobContext?.close();
    await service.app.close();
    if (path.dirname(path.resolve(data)) !== path.resolve(out))
      throw Error('Unexpected recovery fixture path');
    rmSync(data, { recursive: true, force: true });
  }
}
