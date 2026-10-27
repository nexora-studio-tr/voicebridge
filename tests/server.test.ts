import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { once } from 'node:events';
import { get, type ServerResponse } from 'node:http';
import { createServer } from '../src/server/app.js';
import type { Gateway } from '../src/bot/discord.js';
import type { Member } from '../src/core/contracts.js';
import { engine, temporary } from './helpers.js';
const guild = '111111111111111111',
  channel = '222222222222222222',
  user = '333333333333333333';
describe('HTTP authorization and isolated demo sessions', () => {
  let dir: ReturnType<typeof temporary>,
    service: Awaited<ReturnType<typeof createServer>>,
    members: Map<string, Member>;
  const host = '127.0.0.1:4347',
    origin = 'http://' + host;
  const headers = (cookie?: string, csrf?: string) => ({
    host,
    origin,
    ...(cookie ? { cookie } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
  });
  async function start(demo = false) {
    members = new Map([
      [
        user,
        {
          id: user,
          name: 'Alice',
          guildId: guild,
          guildName: 'Guild',
          channelId: channel,
          channelName: 'Voice',
          admin: false,
        },
      ],
    ]);
    const gateway: Gateway = {
      ready: () => true,
      status: () => ({ connected: true, configured: true, error: null }),
      start: async () => {},
      stop: () => {},
      member: async (g, id) => (g === guild ? (members.get(id) ?? null) : null),
      allowed: (r, id) =>
        members.get(id)?.guildId === r.guildId && members.get(id)?.channelId === r.channelId,
    };
    return createServer({
      root: path.resolve('.'),
      dataDir: dir.root,
      origin,
      demo,
      gateway,
      local: engine(),
    });
  }
  beforeEach(() => {
    dir = temporary();
  });
  it('rejects application IDs and bot tokens pasted as OAuth secrets without changing configuration', async () => {
    service = await start();
    const config = {
      applicationId: guild,
      guilds: [guild],
      token: 'fake-bot-token-that-must-be-retained',
      clientSecret: 'fake-current-client-secret',
    };
    service.store.set('discord', config);
    const session = service.store.createSession({
      id: 'operator',
      name: 'Operator',
      operator: true,
    });
    for (const [value, error] of [
      [guild, 'DISCORD_SECRET_IS_APPLICATION_ID'],
      [config.token, 'DISCORD_SECRET_IS_BOT_TOKEN'],
    ]) {
      const reply = await service.app.inject({
        method: 'PUT',
        url: '/api/operator/discord',
        headers: headers('vb-session=' + session.id, session.csrf),
        payload: { clientSecret: value },
      });
      expect(reply.statusCode).toBe(400);
      expect(reply.json().error).toBe(error);
      expect(service.store.get('discord')).toEqual(config);
    }
  });
  it('does not bypass login rate limits with forged rotating cookies', async () => {
    service = await start();
    let status = 0;
    for (let i = 0; i < 21; i++)
      status = (
        await service.app.inject({
          method: 'POST',
          url: '/auth/operator',
          headers: headers('vb-session=forged-' + i),
          payload: { token: 'wrong-token-that-is-at-least-twenty-characters' },
        })
      ).statusCode;
    expect(status).toBe(429);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await service?.app.close();
    dir.remove();
  });
  it('updates only OAuth secret while retaining a connected bot and redacting all secrets', async () => {
    service = await start();
    const old = {
      applicationId: guild,
      guilds: [guild],
      token: 'fake-dedicated-test-bot-token',
      clientSecret: 'fake-old-client-secret',
    };
    service.store.set('discord', old);
    const session = service.store.createSession({
        id: 'operator',
        name: 'Operator',
        operator: true,
      }),
      auth = headers('vb-session=' + session.id, session.csrf);
    const saved = await service.app.inject({
      method: 'PUT',
      url: '/api/operator/discord',
      headers: auth,
      payload: { clientSecret: 'fake-replacement-client-secret' },
    });
    expect(saved.statusCode).toBe(200);
    expect(service.store.get('discord')).toEqual({
      ...old,
      clientSecret: 'fake-replacement-client-secret',
    });
    const summary = await service.app.inject({ url: '/api/operator', headers: auth });
    expect(summary.body).not.toContain('fake-replacement');
    expect(summary.body).not.toContain(old.token);
    const changedBot = await service.app.inject({
      method: 'PUT',
      url: '/api/operator/discord',
      headers: auth,
      payload: { token: 'another-fake-dedicated-bot-token' },
    });
    expect(changedBot.statusCode).toBe(409);
  });
  it('redirects rejected OAuth callbacks to a friendly error without exposing the authorization code', async () => {
    service = await start();
    service.store.set('discord', {
      applicationId: guild,
      guilds: [guild],
      token: 'fake-test-bot-token-long-enough',
      clientSecret: 'fake-client-secret-value',
    });
    const begin = await service.app.inject({ url: '/auth/discord', headers: headers() }),
      state = new URL(begin.headers.location!).searchParams.get('state')!,
      binding = begin.cookies.find((c) => c.name === 'vb-oauth')!;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', request);
    const callback = await service.app.inject({
      url: '/auth/callback?code=private-test-code&state=' + state,
      headers: headers('vb-oauth=' + binding.value),
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/#auth-error=DISCORD_OAUTH_CLIENT_REJECTED');
    expect(callback.headers.location).not.toContain('private-test-code');
    const replay = await service.app.inject({
      url: '/auth/callback?code=private-test-code&state=' + state,
      headers: headers('vb-oauth=' + binding.value),
    });
    expect(replay.headers.location).toBe('/#auth-error=OAUTH_STATE_REJECTED');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects untrusted hosts, cross-origin writes and missing CSRF', async () => {
    service = await start();
    expect(
      (await service.app.inject({ url: '/api/session', headers: { host: 'evil.example' } }))
        .statusCode,
    ).toBe(421);
    expect(
      (
        await service.app.inject({
          method: 'POST',
          url: '/auth/operator',
          headers: { host, origin: 'https://evil.example' },
          payload: { token: 'x'.repeat(30) },
        })
      ).statusCode,
    ).toBe(403);
    const s = service.store.createSession({ id: user, name: 'Alice', operator: false });
    expect(
      (
        await service.app.inject({
          method: 'POST',
          url: '/auth/logout',
          headers: headers('vb-session=' + s.id),
          payload: {},
        })
      ).json().error,
    ).toBe('CSRF_REJECTED');
  });
  it('serves nonce CSP, blocks browser mic access and makes the launch link single-use', async () => {
    service = await start();
    const launch = service.operatorUrl!.split('#operator=')[1]!;
    const response = await service.app.inject({
      method: 'POST',
      url: '/auth/operator',
      headers: headers(),
      payload: { token: launch },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['permissions-policy']).toContain('microphone=()');
    expect(
      (
        await service.app.inject({
          method: 'POST',
          url: '/auth/operator',
          headers: headers(),
          payload: { token: launch },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('does not grant room access from identity alone or from another voice room', async () => {
    service = await start();
    const r = service.rooms.create(guild, 'Guild', channel, 'Room', user),
      s = service.store.createSession({ id: user, name: 'Alice', operator: false }),
      cookie = 'vb-session=' + s.id;
    expect(
      (await service.app.inject({ url: '/api/rooms/' + r.id, headers: headers(cookie) }))
        .statusCode,
    ).toBe(200);
    members.get(user)!.channelId = '999999999999999999';
    expect(
      (await service.app.inject({ url: '/api/rooms/' + r.id, headers: headers(cookie) }))
        .statusCode,
    ).toBe(403);
  });
  it('checks guild administration before exposing provider metadata or budgets', async () => {
    service = await start();
    const s = service.store.createSession({ id: user, name: 'Alice', operator: false }),
      cookie = 'vb-session=' + s.id;
    expect(
      (await service.app.inject({ url: `/api/guilds/${guild}/budget`, headers: headers(cookie) }))
        .statusCode,
    ).toBe(403);
    members.get(user)!.admin = true;
    expect(
      (await service.app.inject({ url: `/api/guilds/${guild}/budget`, headers: headers(cookie) }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await service.app.inject({
          url: '/api/guilds/444444444444444444/budget',
          headers: headers(cookie),
        })
      ).statusCode,
    ).toBe(403);
  });
  it('never returns saved bot secrets and rejects a non-operator setup write', async () => {
    service = await start();
    service.store.set('discord', {
      applicationId: guild,
      guilds: [guild],
      token: 'a-private-discord-token',
      clientSecret: 'private-oauth-client-secret',
    });
    const s = service.store.createSession({ id: 'operator', name: 'Operator', operator: true });
    const response = await service.app.inject({
      url: '/api/operator',
      headers: headers('vb-session=' + s.id),
    });
    expect(response.body).not.toContain('a-private-discord-token');
    expect(response.body).not.toContain('private-oauth');
    const member = service.store.createSession({ id: user, name: 'Alice', operator: false });
    expect(
      (
        await service.app.inject({
          method: 'PUT',
          url: '/api/operator/discord',
          headers: headers('vb-session=' + member.id, member.csrf),
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it('creates per-visitor demo rooms and prevents demo configuration changes', async () => {
    service = await start(true);
    const visitor = await service.app.inject({ url: '/api/session', headers: headers() }),
      cookie = visitor.cookies[0]!.name + '=' + visitor.cookies[0]!.value,
      csrf = visitor.json().csrf;
    const rooms = await service.app.inject({ url: '/api/rooms', headers: headers(cookie) }),
      id = rooms.json()[0].id;
    const second = await service.app.inject({ url: '/api/session', headers: headers() }),
      cookie2 = second.cookies[0]!.name + '=' + second.cookies[0]!.value;
    expect(
      (await service.app.inject({ url: '/api/rooms/' + id, headers: headers(cookie2) })).statusCode,
    ).toBe(404);
    expect(
      (
        await service.app.inject({
          method: 'POST',
          url: '/api/operator/connect',
          headers: headers(cookie, csrf),
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await service.app.inject({
          method: 'PUT',
          url: `/api/rooms/${id}/preferences`,
          headers: headers(cookie, csrf),
          payload: { mode: 'cloud', language: 'tr', audio: false },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('does not write room resets to an ended SSE response during shutdown', async () => {
    service = await start(true);
    let duringClose = () => {};
    service.app.addHook('preClose', async () => duringClose());
    const streams: ServerResponse[] = [];
    service.app.server.on('request', (req, res) => {
      if (req.url?.endsWith('/events')) streams.push(res);
    });
    const visitor = await service.app.inject({ url: '/api/session', headers: headers() });
    const cookie = visitor.cookies[0]!.name + '=' + visitor.cookies[0]!.value;
    const listed = await service.app.inject({ url: '/api/rooms', headers: headers(cookie) });
    const room = service.rooms.rooms.get(listed.json()[0].id)!;
    const address = await service.app.listen({ host: '127.0.0.1', port: 0 });
    const request = get({
      hostname: '127.0.0.1',
      port: new URL(address).port,
      path: `/api/rooms/${room.id}/events`,
      headers: headers(cookie),
    });
    try {
      const [response] = await once(request, 'response');
      expect(response.statusCode).toBe(200);
      const stream = streams[0]!;
      const writes = vi.spyOn(stream, 'write');
      const ended = once(response, 'end');
      response.resume();
      duringClose = () => {
        expect(stream.writableEnded).toBe(true);
        service.rooms.broadcast(room, { type: 'state', data: { reason: 'shutdown' } });
      };
      await service.app.close();
      await ended;
      expect(writes).not.toHaveBeenCalled();
      expect(service.rooms.rooms.size).toBe(0);
    } finally {
      request.destroy();
    }
  });
});
