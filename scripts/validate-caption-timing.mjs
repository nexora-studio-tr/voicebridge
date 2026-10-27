import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from '../dist/server/app.js';
import { wav } from '../dist/core/audio.js';
import { root } from './runtime.mjs';

/** Real app/HTTP/SSE, synthetic gateway and inference; never a live Discord or capacity test. */
export async function validateCaptionTiming(browser, out) {
  const data = mkdtempSync(path.join(out, 'timing-'));
  const origin = 'http://127.0.0.1:4391';
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2);
  const audio = wav(pcm);
  const gateway = {
    ready: () => true,
    status: () => ({ connected: true, configured: true, error: null }),
    start: async () => {
      throw Error('Synthetic fixture must not connect Discord');
    },
    stop: () => {},
    member: async (_guild, id) => ({
      id,
      name: 'Synthetic listener',
      guildId: '111111111111111111',
      guildName: 'Synthetic fixture',
      channelId: '222222222222222222',
      channelName: 'Timing fixture',
      admin: false,
    }),
    allowed: () => true,
  };
  const service = await createServer({
    root,
    dataDir: data,
    origin,
    gateway,
    local: {
      recognize: async () => {
        await pause(8);
        return 'Hello from a synthetic timing test.';
      },
      translate: async () => {
        await pause(8);
        return 'Sentetik zamanlama testinden merhaba.';
      },
      speak: async () => {
        await pause(15);
        return audio;
      },
    },
  });
  let context;
  try {
    const room = service.rooms.create(
      '111111111111111111',
      'Synthetic fixture',
      '222222222222222222',
      'Timing fixture',
      'speaker',
    );
    service.rooms.addSpeaker(room, 'speaker', 'Synthetic speaker');
    service.rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
    const session = service.store.createSession({
      id: 'listener',
      name: 'Synthetic listener',
      operator: false,
    });
    await service.app.listen({ host: '127.0.0.1', port: 4391 });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'vb-session', value: session.id, url: origin, httpOnly: true, sameSite: 'Strict' },
    ]);
    const page = await context.newPage(),
      errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(origin);
    await expect.poll(() => room.listeners.get('listener')?.events.size ?? 0).toBeGreaterThan(0);
    service.rooms.ingest(room, 'speaker', audio);
    await expect(page.locator('.caption')).toHaveCount(1);
    await page.getByRole('button', { name: 'Gecikme ayrıntıları', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Sunucu işlem süresi', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Ölçülmedi');
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: path.join(out, 'caption-timing-tr.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Gecikme ayrıntıları', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Sesli dinlemeyi aç', exact: true }).click();
    await expect.poll(() => room.listeners.get('listener')?.preferences.audio).toBe(true);
    service.rooms.ingest(room, 'speaker', audio);
    await expect
      .poll(() => room.listeners.get('listener')?.captions[0]?.timing?.audioMs)
      .toBeGreaterThan(0);
    const timing = room.listeners.get('listener').captions[0].timing;
    expect(timing.captionMs).toBe(
      timing.queueMs + timing.recognitionMs + timing.translationMs + timing.captionOverheadMs,
    );
    expect(timing.audioMs).toBe(timing.captionMs + timing.synthesisMs + timing.audioOverheadMs);
    await page.getByRole('button', { name: 'Switch interface to English', exact: true }).click();
    await page.getByRole('button', { name: 'Latency details', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Audio ready · total');
    await expect(page.getByRole('dialog')).toContainText(
      'Capture, Discord transit and browser playback are not included.',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.modal').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: path.join(out, 'caption-timing-mobile-en.png'), fullPage: true });
    service.rooms.consent(room, 'speaker', { local: false, cloud: false, language: 'en' });
    await expect(page.locator('.caption')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
    const checks = [
      'Synthetic live-shaped HTTP/SSE fixture shows monotonic queue/recognition/translation timings',
      'Caption and audio readiness are separate and component durations reconcile',
      'Timing dialog supports TR/EN, keyboard focus return, automated accessibility rules and 390px layout',
      'Consent revocation removes timing dialogs with captions; no external requests or model/Discord calls',
    ];
    writeFileSync(
      path.join(out, 'caption-timing-report.json'),
      JSON.stringify(
        {
          status: 'passed',
          checks,
          fixture: 'synthetic gateway and inference',
          liveDiscord: false,
          paidApi: false,
          benchmarkClaim: false,
        },
        null,
        2,
      ),
    );
    return checks;
  } finally {
    await context?.close();
    await service.app.close();
    if (path.dirname(path.resolve(data)) !== path.resolve(out))
      throw Error('Refusing unexpected fixture cleanup');
    rmSync(data, { recursive: true, force: true });
  }
}
