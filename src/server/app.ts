import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  BudgetPolicy,
  DiscordConfig,
  ProviderConfig,
  Fault,
  Snowflake,
  VERSION,
  check,
  type Inference,
} from '../core/contracts.js';
import { Store, hash, same, token } from '../core/store.js';
import { Rooms } from '../core/rooms.js';
import { DiscordBridge, type Gateway } from '../bot/discord.js';
import { CloudEngine } from './cloud.js';
import { LocalWorker } from './local.js';
import { RecordedDemo } from './demo.js';
import { exchangeDiscordCode } from './oauth.js';

export interface AppOptions {
  root: string;
  dataDir: string;
  origin: string;
  demo?: boolean;
  gateway?: Gateway;
  local?: Inference;
  workerPort?: number;
}
export async function createServer(options: AppOptions) {
  const origin = new URL(options.origin);
  check(origin.origin === options.origin, 'INVALID_PUBLIC_ORIGIN');
  check(
    origin.protocol === 'https:' ||
      (origin.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)),
    'HTTPS_REQUIRED',
  );
  const store = new Store(options.dataDir),
    mode = options.demo ? 'demo' : 'operator';
  const old = store.get<string>('application.mode');
  if (old && old !== mode) {
    store.close();
    throw new Fault('DATA_MODE_MISMATCH', 409);
  }
  store.set('application.mode', mode);
  const app = Fastify({
    logger: false,
    bodyLimit: 20_000,
    requestTimeout: 15_000,
    connectionTimeout: 15_000,
  });
  await app.register(cookie);
  const gateway = options.gateway ?? new DiscordBridge(store, options.origin);
  const demo = new RecordedDemo(options.root);
  const worker =
    !options.local && !options.demo
      ? new LocalWorker(options.root, options.dataDir, options.workerPort)
      : null;
  worker?.start();
  const local = options.demo ? demo : (options.local ?? worker!);
  const cloudAllowed = (guild: string) =>
    !!store.get<ProviderConfig>('provider:' + guild) && store.policy(guild).enabled;
  const rooms = new Rooms(
    local,
    (ctx) => {
      const cfg = store.get<ProviderConfig>('provider:' + ctx.guildId);
      check(cfg, 'PROVIDER_NOT_CONFIGURED', 409);
      return new CloudEngine(store, ProviderConfig.parse(cfg), ctx);
    },
    (r, id) =>
      options.demo
        ? r.guildId.startsWith('demo:') && (id.startsWith('sample-') || r.listeners.has(id))
        : gateway.allowed(r, id),
    cloudAllowed,
  );
  if (gateway instanceof DiscordBridge) {
    gateway.rooms = rooms;
    rooms.onConsentChange = (r, id) => gateway.interruptSpeaker(r, id);
  }
  // Cookies ignore TCP ports: the recorded demo must not replace a real user/operator session.
  const cookieName =
    (origin.protocol === 'https:' ? '__Host-vb' : 'vb-session') + (options.demo ? '-demo' : '');
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: origin.protocol === 'https:',
    sameSite: 'strict' as const,
    maxAge: 12 * 3600,
  };
  const session = (req: FastifyRequest) => store.session(req.cookies[cookieName]);
  const identity = (req: FastifyRequest) => {
    const s = session(req);
    check(s, 'AUTH_REQUIRED', 401);
    return s.user;
  };
  const operator = (req: FastifyRequest) => {
    const user = identity(req);
    check(user.operator && !options.demo, 'OPERATOR_REQUIRED', 403);
    return user;
  };
  const rate = new Map<string, { until: number; count: number }>();
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.host !== origin.host) return reply.code(421).send({ error: 'HOST_REJECTED' });
    const csrfMethods = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (csrfMethods && req.headers.origin !== origin.origin)
      return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
    const authRoute = req.url.startsWith('/auth/');
    // Untrusted/rotating cookies must not create fresh rate-limit identities.
    const known = authRoute ? null : session(req);
    const key = (known?.id ?? req.ip) + (authRoute ? ':auth' : ':api');
    const now = Date.now(),
      r = rate.get(key);
    if (r && r.until > now) {
      if (++r.count > (req.url.startsWith('/auth/') ? 20 : 300))
        return reply.code(429).send({ error: 'RATE_LIMIT' });
    } else rate.set(key, { until: now + 60_000, count: 1 });
    if (rate.size > 2000)
      for (const [k, v] of rate) if (v.until < now || rate.size > 2000) rate.delete(k);
    if (csrfMethods && req.url !== '/auth/operator') {
      const s = session(req);
      if (!s) return reply.code(401).send({ error: 'AUTH_REQUIRED' });
      if (!same(String(req.headers['x-csrf-token'] ?? ''), s.csrf))
        return reply.code(403).send({ error: 'CSRF_REJECTED' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    const nonce = randomBytes(18).toString('base64');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
    reply.header('Cache-Control', 'no-store');
    if (origin.protocol === 'https:') reply.header('Strict-Transport-Security', 'max-age=31536000');
    return typeof payload === 'string' ? payload.replace('__CSP_NONCE__', nonce) : payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (_req.routeOptions.url === '/auth/callback')
      return reply.redirect(
        '/#auth-error=' + (error instanceof Fault ? error.code : 'DISCORD_OAUTH_UNAVAILABLE'),
      );
    reply
      .code(error instanceof Fault ? error.status : error instanceof z.ZodError ? 400 : 500)
      .send({
        error:
          error instanceof Fault
            ? error.code
            : error instanceof z.ZodError
              ? 'INVALID_INPUT'
              : 'INTERNAL_ERROR',
      });
  });
  const admin = async (req: FastifyRequest, guild: string) => {
    const user = identity(req);
    check(!options.demo, 'DEMO_READ_ONLY', 403);
    if (user.operator) return user;
    const m = await gateway.member(guild, user.id, true);
    check(m?.admin, 'ADMIN_REQUIRED', 403);
    return user;
  };
  const access = async (req: FastifyRequest, roomId: string) => {
    const user = identity(req),
      room = rooms.get(roomId);
    if (options.demo) {
      check(room.guildId === 'demo:' + user.id, 'ROOM_NOT_FOUND', 404);
      return { user, room };
    }
    const m = await gateway.member(room.guildId, user.id);
    check(
      m?.channelId === room.channelId && gateway.allowed(room, user.id),
      'VOICE_MEMBERSHIP_REQUIRED',
      403,
    );
    return { user, room };
  };
  const join = async (req: FastifyRequest, roomId: string) => {
    const result = await access(req, roomId);
    rooms.join(result.room, result.user.id, result.user.name);
    return result;
  };
  app.get('/healthz', () => ({ ok: true, version: VERSION, mode }));
  app.get('/api/session', async (req, reply) => {
    let s = session(req);
    if (options.demo && !s) {
      const user = { id: 'demo-' + token().slice(0, 16), name: 'Dinleyici', operator: false };
      const created = store.createSession(user);
      reply.setCookie(cookieName, created.id, cookieOptions);
      s = store.session(created.id);
    }
    return {
      mode,
      version: VERSION,
      identity: s?.user ?? null,
      csrf: s?.csrf ?? null,
      discord: gateway.status(),
    };
  });
  let operatorUrl: string | null = null;
  if (!options.demo) {
    store.db.prepare("DELETE FROM once WHERE purpose='operator'").run();
    const launch = store.issueOnce('operator', {}, 30 * 60_000);
    operatorUrl = options.origin + '/#operator=' + launch;
    writeFileSync(path.join(options.dataDir, 'operator-link'), operatorUrl, { mode: 0o600 });
  }
  app.post('/auth/operator', async (req, reply) => {
    check(!options.demo, 'DEMO_READ_ONLY', 403);
    const body = z.object({ token: z.string().min(20).max(150) }).parse(req.body);
    check(store.consumeOnce(body.token, 'operator'), 'LINK_EXPIRED', 401);
    const s = store.createSession({ id: 'operator', name: 'Operatör', operator: true });
    reply.setCookie(cookieName, s.id, cookieOptions);
    return { ok: true };
  });
  app.post('/auth/logout', async (req, reply) => {
    if (req.cookies[cookieName]) store.revoke(req.cookies[cookieName]!);
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });
  app.get('/auth/discord', async (_req, reply) => {
    check(!options.demo, 'DEMO_READ_ONLY', 403);
    const cfg = store.get<DiscordConfig>('discord');
    check(cfg, 'DISCORD_NOT_CONFIGURED', 409);
    const binding = token(),
      state = store.issueOnce('oauth', { binding: hash(binding) }, 300_000);
    reply.setCookie('vb-oauth', binding, {
      path: '/',
      httpOnly: true,
      secure: cookieOptions.secure,
      sameSite: 'lax',
      maxAge: 300,
    });
    const q = new URLSearchParams({
      client_id: cfg.applicationId,
      response_type: 'code',
      scope: 'identify',
      redirect_uri: options.origin + '/auth/callback',
      state,
    });
    return reply.redirect('https://discord.com/oauth2/authorize?' + q);
  });
  app.get('/auth/callback', async (req, reply) => {
    check(!options.demo, 'DEMO_READ_ONLY', 403);
    const q = z.object({ code: z.string().max(1000), state: z.string().max(150) }).parse(req.query);
    const saved = store.consumeOnce<{ binding: string }>(q.state, 'oauth');
    check(
      saved && same(saved.binding, hash(req.cookies['vb-oauth'] ?? '')),
      'OAUTH_STATE_REJECTED',
      403,
    );
    reply.clearCookie('vb-oauth', { path: '/' });
    const cfg = store.get<DiscordConfig>('discord');
    check(cfg, 'DISCORD_NOT_CONFIGURED', 409);
    const s = store.createSession(await exchangeDiscordCode(cfg, options.origin, q.code));
    reply.setCookie(cookieName, s.id, cookieOptions);
    return reply.redirect('/');
  });
  app.get('/api/operator', (req) => {
    operator(req);
    const cfg = store.get<DiscordConfig>('discord');
    return {
      discord: {
        applicationId: cfg?.applicationId ?? '',
        guilds: cfg?.guilds ?? [],
        hasToken: !!cfg?.token,
        hasSecret: !!cfg?.clientSecret,
      },
      origin: options.origin,
      redirectUri: options.origin + '/auth/callback',
      status: gateway.status(),
    };
  });
  app.put('/api/operator/discord', (req) => {
    operator(req);
    const previous = store.get<DiscordConfig>('discord');
    const patch = DiscordConfig.partial().parse(req.body);
    const input = DiscordConfig.parse({ ...previous, ...patch });
    check(input.clientSecret !== input.applicationId, 'DISCORD_SECRET_IS_APPLICATION_ID');
    check(input.clientSecret !== input.token, 'DISCORD_SECRET_IS_BOT_TOKEN');
    const botChanged =
      !previous ||
      previous.applicationId !== input.applicationId ||
      previous.token !== input.token ||
      previous.guilds.join(',') !== input.guilds.join(',');
    check(!botChanged || !gateway.ready(), 'DISCONNECT_BEFORE_CONFIG', 409);
    store.set('discord', input);
    return { ok: true };
  });
  app.post('/api/operator/connect', async (req) => {
    operator(req);
    await gateway.start();
    return gateway.status();
  });
  app.post('/api/operator/disconnect', (req) => {
    operator(req);
    gateway.stop();
    return gateway.status();
  });
  app.get('/api/operator/models', async (req) => {
    operator(req);
    return worker ? worker.status() : { ready: !!options.local, device: 'injected' };
  });
  app.get('/api/guilds/:guild/budget', async (req) => {
    const guild = Snowflake.parse((req.params as { guild: string }).guild);
    await admin(req, guild);
    const p = store.get<ProviderConfig>('provider:' + guild);
    return {
      ...store.summary(guild),
      provider: p
        ? {
            kind: p.kind,
            recognition: p.recognition,
            translation: p.translation,
            speech: p.speech,
            voice: p.voice,
            prices: p.prices,
            hasKey: true,
          }
        : null,
    };
  });
  app.put('/api/guilds/:guild/budget', async (req) => {
    const guild = Snowflake.parse((req.params as { guild: string }).guild);
    await admin(req, guild);
    const p = BudgetPolicy.parse(req.body);
    if (p.enabled) check(store.get('provider:' + guild), 'PROVIDER_NOT_CONFIGURED', 409);
    store.setPolicy(guild, p);
    return { ok: true };
  });
  app.put('/api/guilds/:guild/provider', async (req) => {
    const guild = Snowflake.parse((req.params as { guild: string }).guild);
    await admin(req, guild);
    const input = ProviderConfig.parse(req.body);
    store.set('provider:' + guild, input);
    for (const r of rooms.rooms.values())
      if (r.guildId === guild)
        for (const l of r.listeners.values())
          rooms.preferences(r, l.id, { ...l.preferences, mode: 'local' });
    return { ok: true };
  });
  app.delete('/api/guilds/:guild/provider', async (req) => {
    const guild = Snowflake.parse((req.params as { guild: string }).guild);
    await admin(req, guild);
    store.delete('provider:' + guild);
    store.setPolicy(guild, { ...store.policy(guild), enabled: false });
    for (const r of rooms.rooms.values())
      if (r.guildId === guild)
        for (const l of r.listeners.values())
          rooms.preferences(r, l.id, { ...l.preferences, mode: 'local' });
    return { ok: true };
  });
  app.get('/api/rooms', async (req) => {
    const user = identity(req);
    if (options.demo) {
      let room = [...rooms.rooms.values()].find((r) => r.guildId === 'demo:' + user.id);
      if (!room) {
        check(rooms.rooms.size < 20, 'DEMO_CAPACITY', 429);
        room = rooms.create(
          'demo:' + user.id,
          'VoiceBridge Studio',
          'sample-room',
          'Studio / Türkçe & English',
          user.id,
        );
        room.listeners.set(user.id, {
          id: user.id,
          name: user.name,
          preferences: { language: 'tr', mode: 'local', audio: false },
          generation: 0,
          events: new Set(),
          captions: [],
        });
        for (const [id, name, language] of [
          ['sample-ece', 'Ece', 'tr'],
          ['sample-deniz', 'Deniz', 'en'],
        ] as const) {
          const s = rooms.addSpeaker(room, id, name);
          s.consent = { local: true, cloud: false, language };
        }
      }
      return [rooms.state(room, user.id)];
    }
    const result = [];
    for (const room of rooms.rooms.values()) {
      const m = await gateway.member(room.guildId, user.id);
      if (m?.channelId === room.channelId && gateway.allowed(room, user.id))
        result.push(rooms.state(room, user.id));
    }
    return result;
  });
  app.get('/api/rooms/:room', async (req) => {
    const { room, user } = await join(req, (req.params as { room: string }).room);
    return rooms.state(room, user.id);
  });
  app.put('/api/rooms/:room/preferences', async (req) => {
    const { room, user } = await join(req, (req.params as { room: string }).room);
    return rooms.preferences(room, user.id, req.body);
  });
  app.put('/api/rooms/:room/consent', async (req) => {
    check(!options.demo, 'DEMO_READ_ONLY', 403);
    const { room, user } = await join(req, (req.params as { room: string }).room);
    return rooms.consent(room, user.id, req.body);
  });
  app.post('/api/rooms/:room/demo', async (req) => {
    check(options.demo, 'DEMO_ONLY', 403);
    const { room } = await access(req, (req.params as { room: string }).room);
    const body = z.object({ play: z.boolean() }).parse(req.body);
    if (body.play) demo.play(rooms, room);
    else demo.stop(room.id);
    return { ok: true };
  });
  app.get('/api/rooms/:room/audio/:audio', async (req, reply) => {
    const p = req.params as { room: string; audio: string };
    const { room, user } = await access(req, p.room);
    return reply
      .type('audio/wav')
      .header('Cache-Control', 'no-store')
      .send(rooms.audio(room, user.id, p.audio));
  });
  app.get('/api/rooms/:room/events', async (req, reply) => {
    const { room, user } = await join(req, (req.params as { room: string }).room);
    const unsubscribe = rooms.subscribe(room, user.id, (event) => send(event));
    reply.hijack();
    streams.add(reply.raw);
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      connection: 'keep-alive',
    });
    const send = (event: unknown) => {
      if (reply.raw.writableLength > 128 * 1024) {
        reply.raw.end();
        return;
      }
      reply.raw.write('data: ' + JSON.stringify(event) + '\n\n');
    };
    reply.raw.write(': connected\n\n');
    const heartbeat = setInterval(async () => {
      try {
        await access(req, room.id);
        reply.raw.write(': heartbeat\n\n');
      } catch {
        reply.raw.end();
      }
    }, 5000);
    heartbeat.unref();
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(reply.raw);
    });
  });
  const webRoot = path.join(options.root, 'dist/web');
  if (existsSync(webRoot))
    await app.register(staticFiles, {
      root: webRoot,
      prefix: '/',
      index: false,
      decorateReply: false,
      cacheControl: false,
    });
  app.get('/', async (_req, reply) => {
    const file = path.join(webRoot, 'index.html');
    if (!existsSync(file))
      return reply.type('text/plain').code(503).send('Build VoiceBridge first: npm run build');
    return reply.type('text/html').send(readFileSync(file, 'utf8'));
  });
  const streams = new Set<import('node:http').ServerResponse>();
  let pruneTicks = 0;
  const cleanup = setInterval(() => {
    if (++pruneTicks % 30 === 0) store.prune();
    for (const r of rooms.rooms.values()) {
      for (const l of r.listeners.values())
        l.captions = l.captions.filter((c) => c.createdAt > Date.now() - 90_000);
      for (const [k, m] of r.media) if (m.expires < Date.now()) r.media.delete(k);
      if (options.demo && Date.now() - r.touchedAt > 300_000) {
        demo.stop(r.id);
        rooms.stop(r, 'expired');
      }
    }
  }, 1000);
  cleanup.unref();
  app.addHook('preClose', async () => {
    clearInterval(cleanup);
    for (const stream of streams) stream.end();
  });
  app.addHook('onClose', async () => {
    demo.close();
    rooms.stopAll();
    gateway.stop();
    worker?.stop();
    store.close();
  });
  return { app, store, rooms, gateway, worker, operatorUrl };
}
