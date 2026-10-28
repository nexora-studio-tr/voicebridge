import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Installer } from './contracts.js';
import { VERSION } from '../core/contracts.js';

export async function createLauncherServer(options: {
  webRoot: string;
  token: string;
  installer: Installer;
  origin?: string;
  quit?: () => void;
}) {
  let origin = options.origin || 'http://127.0.0.1:4370';
  const app = Fastify({ logger: false, bodyLimit: 2048 });
  const equal = (value: unknown, expected: string) =>
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  const cookieName = () => 'vb_launcher_' + new URL(origin).port;
  await app.register(cookie);
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.host !== new URL(origin).host)
      return reply.code(403).send({ error: 'HOST_REJECTED' });
    if (
      req.method !== 'GET' &&
      (req.headers.origin !== origin || req.headers['x-vb-launcher'] !== '1')
    )
      return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
    if (
      req.url.startsWith('/api/') &&
      req.url !== '/api/bootstrap' &&
      !equal(req.cookies[cookieName()], options.token)
    )
      return reply.code(401).send({ error: 'AUTH_REQUIRED' });
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    const nonce = randomBytes(18).toString('base64');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    reply
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
    return typeof payload === 'string' ? payload.replaceAll('__CSP_NONCE__', nonce) : payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    const code = (error as { statusCode?: number }).statusCode;
    const status = typeof code === 'number' && code < 500 ? code : 400;
    reply.code(status).send({ error: 'REQUEST_FAILED' });
  });
  await app.register(serveStatic, { root: options.webRoot, index: false });
  app.get('/install', async (_req, reply) =>
    reply.type('text/html').send(await readFile(path.join(options.webRoot, 'index.html'), 'utf8')),
  );
  app.get('/healthz', () => ({ app: 'voicebridge-launcher', version: VERSION }));
  app.post('/api/bootstrap', async (req, reply) => {
    const body = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(req.body);
    if (!body.success || !equal(body.data.token, options.token))
      return reply.code(401).send({ error: 'AUTH_REQUIRED' });
    reply.setCookie(cookieName(), options.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      maxAge: 86400,
    });
    return { ok: true };
  });
  app.get('/api/status', () => options.installer.status);
  app.post('/api/install', async (req, reply) => {
    if (
      !z
        .object({ consent: z.literal(true) })
        .strict()
        .safeParse(req.body).success
    )
      return reply.code(400).send({ error: 'CONSENT_REQUIRED' });
    if (['installing', 'running', 'starting'].includes(options.installer.status.state))
      return reply.code(409).send({ error: 'INSTALL_BUSY' });
    void options.installer.prepare().catch(() => {});
    return { ok: true };
  });
  app.post('/api/pause', async () => {
    options.installer.pause();
    return { ok: true };
  });
  app.post('/api/launch', async (_req, reply) => {
    if (options.installer.status.state !== 'ready')
      return reply.code(409).send({ error: 'SETUP_REQUIRED' });
    await options.installer.launch();
    return options.installer.status;
  });
  app.post('/api/stop', async () => {
    await options.installer.stop();
    return options.installer.status;
  });
  app.post('/api/quit', async () => {
    await options.installer.stop();
    setImmediate(() => options.quit?.());
    return { ok: true };
  });
  return {
    app,
    setOrigin: (value: string) => {
      const parsed = new URL(value);
      if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:')
        throw Error('INVALID_ORIGIN');
      origin = value;
    },
  };
}
