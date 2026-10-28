import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from '../dist/server/app.js';
import { wav } from '../dist/core/audio.js';
import { PerformanceReport } from '../dist/core/performance.js';
import { root } from './runtime.mjs';

/** Real HTTP/browser with synthetic inference. No Discord, provider, speech-quality or capacity claim. */
export async function validatePerformance(browser, out) {
  const data = mkdtempSync(path.join(out, 'performance-'));
  const origin = 'http://127.0.0.1:4393';
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2);
  const audio = wav(pcm);
  let releaseRecognition;
  const gateway = {
    ready: () => false,
    status: () => ({ connected: false, configured: false, error: null }),
    start: async () => {
      throw Error('No live connection permitted in this fixture');
    },
    stop: () => {},
    member: async () => null,
    allowed: () => true,
  };
  const service = await createServer({
    root,
    dataDir: data,
    origin,
    gateway,
    local: {
      recognize: async () => 'PRIVATE-SOURCE-FIXTURE',
      translate: async () => 'PRIVATE-TRANSLATION-FIXTURE',
      speak: async () => audio,
    },
  });
  let context;
  const checks = [];
  try {
    const room = service.rooms.create(
      '111111111111111111',
      'Private fixture',
      '222222222222222222',
      'Private fixture room',
      'speaker',
    );
    service.rooms.addSpeaker(room, 'speaker', 'Private synthetic speaker');
    service.rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
    for (const id of ['alice', 'bob']) {
      service.rooms.join(room, id, 'Private synthetic listener');
      service.rooms.subscribe(room, id, () => {});
      service.rooms.preferences(room, id, { language: 'tr', mode: 'local', audio: true });
    }
    service.store.set('private-context', { token: 'SECRET-PERFORMANCE-FIXTURE' });
    const session = service.store.createSession({
      id: 'operator',
      name: 'Synthetic performance fixture',
      operator: true,
    });
    await service.app.listen({ host: '127.0.0.1', port: 4393 });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'vb-session', value: session.id, url: origin, httpOnly: true, sameSite: 'Strict' },
    ]);
    const page = await context.newPage(),
      errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    const count = () => requests.filter((u) => u === origin + '/api/operator/performance').length;
    await page.goto(origin);
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    expect(count()).toBe(0);
    await page.getByRole('button', { name: 'Performans', exact: true }).click();
    const section = page.locator('.performance-section');
    await expect(section.locator('.performance-report')).toBeVisible();
    await expect(section.locator('.performance-table tbody tr')).toHaveCount(4);
    await expect(section.locator('.performance-table tbody tr').first()).toContainText('—');
    checks.push('Operator measurements are opt-in and distinguish zero samples from zero latency');

    service.rooms.ingest(room, 'speaker', audio);
    await expect.poll(() => service.rooms.performance.snapshot().jobs.completed).toBe(1);
    await section.getByRole('button', { name: 'Ölçümleri yenile', exact: true }).click();
    await expect(
      section.locator('.performance-table tbody tr').first().locator('td').first(),
    ).toHaveText('1');
    await expect(
      section.locator('.performance-table tbody tr').nth(1).locator('td').first(),
    ).toHaveText('1');
    await expect(
      section.locator('.performance-table tbody tr').nth(2).locator('td').first(),
    ).toHaveText('0');
    checks.push(
      'Two listeners share one caption/audio measurement and unused cloud remains unmeasured',
    );

    service.rooms.local.recognize = () =>
      new Promise((resolve) => {
        releaseRecognition = resolve;
      });
    service.rooms.ingest(room, 'speaker', audio);
    for (let i = 0; i < 4; i++) service.rooms.ingest(room, 'speaker', audio);
    await section.getByRole('button', { name: 'Ölçümleri yenile', exact: true }).click();
    await expect(section.locator('.performance-load')).toContainText('2 / 8');
    await expect(section).toContainText('İşler sırada.');
    service.rooms.consent(room, 'speaker', { local: false, cloud: false, language: 'en' });
    releaseRecognition('PRIVATE-CANCELED-FIXTURE');
    releaseRecognition = null;
    await expect.poll(() => service.rooms.queue.active).toBe(0);
    service.rooms.local.recognize = async () => 'PRIVATE-SOURCE-FIXTURE';
    service.rooms.local.speak = async () => {
      throw Error('PRIVATE-ERROR-FIXTURE');
    };
    service.rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
    service.rooms.ingest(room, 'speaker', audio);
    await expect.poll(() => service.rooms.performance.snapshot().jobs.failed).toBe(1);
    await section.getByRole('button', { name: 'Ölçümleri yenile', exact: true }).click();
    await expect(section).toContainText('İşlem hatası kaydedildi.');
    checks.push(
      'Actual queue backpressure, cancellation and synthesis failure produce actionable aggregate states',
    );

    const downloadReady = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Performans raporunu indir', exact: true }).click();
    const download = await downloadReady;
    const json = readFileSync(await download.path(), 'utf8');
    const report = PerformanceReport.parse(JSON.parse(json));
    expect(report.recent.jobs).toEqual({ completed: 1, failed: 1, canceled: 3, noOutput: 0 });
    expect(report.recent.rejected).toBe(2);
    expect(json).not.toMatch(
      /PRIVATE|SECRET|111111111111111111|222222222222222222|alice|bob|operator-link/,
    );
    expect(json).not.toContain(data);
    expect(json).not.toContain(session.id);
    checks.push(
      'Downloaded strict-schema JSON excludes transcripts, errors, identifiers, paths and credentials',
    );

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Switch interface to English', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await expect(section.locator('.performance-report')).toBeVisible();
    await expect(section).toContainText('excluding Python');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'performance-en.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.modal').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: path.join(out, 'performance-mobile-en.png'), fullPage: true });
    checks.push(
      'English performance view passes exercised automatic WCAG A/AA rules and 390px overflow checks',
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.install();
    const firstWatchResponse = page.waitForResponse(origin + '/api/operator/performance');
    await section.getByRole('switch', { name: 'Watch live', exact: true }).click();
    await (await firstWatchResponse).finished();
    await expect(
      section.getByRole('button', { name: 'Refresh measurements', exact: true }),
    ).toBeEnabled();
    const beforeTick = count();
    await page.clock.fastForward(5100);
    await expect.poll(count).toBe(beforeTick + 1);
    await expect(
      section.getByRole('button', { name: 'Refresh measurements', exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const beforeHidden = count();
    await page.clock.fastForward(16000);
    expect(count()).toBe(beforeHidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(count).toBe(beforeHidden + 1);
    await expect(
      section.getByRole('button', { name: 'Refresh measurements', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    const beforeClose = count();
    await page.clock.fastForward(16000);
    expect(count()).toBe(beforeClose);
    checks.push(
      'Live monitoring refreshes at five seconds and suspends on hidden tabs or collapsed sections',
    );

    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await expect(section.locator('.performance-report')).toBeVisible();
    const secondWatchResponse = page.waitForResponse(origin + '/api/operator/performance');
    await section.getByRole('switch', { name: 'Watch live', exact: true }).click();
    await (await secondWatchResponse).finished();
    await expect(
      section.getByRole('button', { name: 'Refresh measurements', exact: true }),
    ).toBeEnabled();
    service.store.revoke(session.id);
    const deniedResponse = page.waitForResponse(
      (response) =>
        response.url() === origin + '/api/operator/performance' && response.status() === 401,
    );
    await page.clock.fastForward(5100);
    await deniedResponse;
    await expect(section.locator('.performance-report')).toHaveCount(0);
    await expect(
      section.getByRole('button', { name: 'Download performance report', exact: true }),
    ).toBeDisabled();
    await expect(
      section.getByRole('switch', { name: 'Watch live', exact: true }),
    ).not.toBeChecked();
    const deniedCount = count();
    await page.clock.fastForward(16000);
    expect(count()).toBe(deniedCount);
    checks.push(
      'Expired authorization clears the snapshot, disables export and stops automatic retries',
    );
    expect(errors).toEqual([]);
    expect(requests.every((u) => new URL(u).origin === origin)).toBe(true);
    checks.push('No browser script errors, outbound requests, Discord connection or paid calls');
    writeFileSync(
      path.join(out, 'performance-report.json'),
      JSON.stringify(
        {
          status: 'passed',
          checks,
          fixture:
            'real HTTP; synthetic identities, audio and inference; numerical output is not a benchmark',
          liveDiscord: false,
          paidApi: false,
          humanParticipants: 0,
          capacityClaim: false,
        },
        null,
        2,
      ) + '\n',
    );
    return checks;
  } finally {
    releaseRecognition?.('canceled');
    await context?.close();
    await service.app.close();
    if (path.dirname(path.resolve(data)) !== path.resolve(out))
      throw Error('Unexpected performance fixture path');
    rmSync(data, { recursive: true, force: true });
  }
}
