import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './runtime.mjs';
import { validateCaptionTiming } from './validate-caption-timing.mjs';
import { validateRoomRecovery } from './validate-room-recovery.mjs';
import { validatePerformance } from './validate-performance.mjs';
const out = path.join(root, 'artifacts/browser');
mkdirSync(out, { recursive: true });
const demoOrigin = 'http://127.0.0.1:4388',
  operatorOrigin = 'http://127.0.0.1:4387';
const children = [];
async function start(port, demo) {
  const data = path.join(out, `${demo ? 'demo' : 'operator'}-${Date.now()}`);
  const processHandle = spawn(
    process.execPath,
    ['dist/server/main.js', ...(demo ? ['--demo'] : [])],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_URL: `http://127.0.0.1:${port}`,
        VOICEBRIDGE_DATA: data,
        VOICEBRIDGE_PYTHON: path.join(out, 'no-worker-needed-for-ui-test'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(processHandle);
  let output = '';
  processHandle.stderr.on('data', (b) => {
    output += b.toString();
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return data;
    } catch {}
    if (processHandle.exitCode !== null) throw new Error('Test server exited: ' + output);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Test server did not start');
}
let browser;
const results = [];
try {
  await start(4388, true);
  const operatorData = await start(4387, false);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  page.on('request', (req) => requests.push(req.url()));
  await page.goto(demoOrigin);
  await expect(page.getByRole('button', { name: 'Örneği başlat', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Sesli dinlemeyi aç', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dinlemeyi durdur', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Örneği başlat', exact: true }).click();
  await expect(page.locator('.caption')).toHaveCount(1, { timeout: 10000 });
  await expect
    .poll(() => requests.filter((u) => u.includes('/audio/')).length, { timeout: 10000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.translation')).toContainText('Toplantı');
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  writeFileSync(
    path.join(out, 'accessibility.json'),
    JSON.stringify(accessibility.violations, null, 2),
  );
  expect(
    accessibility.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  results.push(
    'Automated WCAG A/AA rules pass on the desktop demo; this is not a full accessibility certification',
  );
  results.push(
    'Recorded captions and authenticated WAV fetched with real browser playback enabled',
  );
  await page.getByRole('button', { name: 'Örneği durdur', exact: true }).click();
  await page.getByRole('combobox', { name: 'Duymak istediğin dil' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('.caption')).toHaveCount(0);
  results.push('Language changes invalidate caption and audio queues');
  await page.getByRole('button', { name: 'Switch interface to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'How does it work?', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  results.push('English interface and keyboard-dismissable accessible dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  results.push('390px viewport has no horizontal overflow');
  expect(requests.every((u) => new URL(u).origin === demoOrigin)).toBe(true);
  expect(errors).toEqual([]);
  results.push(
    'No application errors, CSP violations or external network requests in recorded demo',
  );
  const operator = await context.newPage(),
    operatorErrors = [];
  operator.on('pageerror', (e) => operatorErrors.push(e.message));
  const link = readFileSync(path.join(operatorData, 'operator-link'), 'utf8');
  await operator.goto(link);
  await expect(operator.getByRole('dialog')).toBeVisible();
  await expect(
    operator.getByRole('button', { name: 'Discord’a bağlan (canlı)', exact: true }),
  ).toBeDisabled();
  expect(await operator.evaluate(() => location.hash)).toBe('');
  await operator.screenshot({ path: path.join(out, 'operator.png'), fullPage: true });
  expect(operatorErrors).toEqual([]);
  results.push(
    'One-use local operator login removes URL fragment and opens setup without a live connection',
  );
  await operator.getByRole('button', { name: 'Kurulumu denetle', exact: true }).click();
  await expect(operator.locator('.setup-check-list li')).toHaveCount(9);
  await expect(operator.locator('.setup-check-list')).toContainText('Python 3.12');
  const reportDownload = operator.waitForEvent('download');
  await operator.getByRole('button', { name: 'Destek raporunu indir', exact: true }).click();
  const downloadedReport = await reportDownload;
  const report = JSON.parse(readFileSync(await downloadedReport.path(), 'utf8'));
  expect(downloadedReport.suggestedFilename()).toBe('voicebridge-setup-report.json');
  expect(report.scope).toBe('installation-snapshot');
  expect(report.checks.find((c) => c.id === 'worker').reason).toBe('python-missing');
  expect(report.checks.find((c) => c.id === 'live').state).toBe('manual');
  expect(JSON.stringify(report)).not.toContain(operatorData);
  expect(JSON.stringify(report)).not.toContain(link);
  const setupAccessibility = await new AxeBuilder({ page: operator })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  writeFileSync(
    path.join(out, 'accessibility-setup.json'),
    JSON.stringify(setupAccessibility.violations, null, 2),
  );
  expect(
    setupAccessibility.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await operator.screenshot({ path: path.join(out, 'setup-checks-tr.png'), fullPage: true });
  await operator.setViewportSize({ width: 390, height: 844 });
  expect(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  expect(await operator.locator('.modal').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await operator.screenshot({ path: path.join(out, 'setup-checks-mobile-tr.png'), fullPage: true });
  await operator.setViewportSize({ width: 1440, height: 1000 });
  await operator.keyboard.press('Escape');
  await operator.getByRole('button', { name: 'Switch interface to English', exact: true }).click();
  await operator.getByRole('button', { name: 'Settings', exact: true }).click();
  await operator.getByRole('button', { name: 'Run setup checks', exact: true }).click();
  await expect(operator.locator('.setup-check-list li')).toHaveCount(9);
  await expect(operator.locator('.setup-check-list')).toContainText(
    'This report is not live-test evidence.',
  );
  await operator.screenshot({ path: path.join(out, 'setup-checks-en.png'), fullPage: true });
  await operator.keyboard.press('Escape');
  await operator.getByRole('button', { name: 'Arayüzü Türkçeye çevir', exact: true }).click();
  await operator.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await operator.getByRole('button', { name: 'Kurulumu denetle', exact: true }).click();
  await expect(operator.locator('.setup-check-list li')).toHaveCount(9);
  results.push(
    'Bilingual operator setup checks, reviewed JSON download, manual evidence boundaries, accessible dialog and 390px layout',
  );
  let releaseSetupResponse, signalSetupReached, signalSetupFulfilled;
  const heldSetupResponse = new Promise((resolve) => {
    releaseSetupResponse = resolve;
  });
  const setupReached = new Promise((resolve) => {
    signalSetupReached = resolve;
  });
  const setupFulfilled = new Promise((resolve) => {
    signalSetupFulfilled = resolve;
  });
  await operator.route('**/api/operator/setup-checks', async (route) => {
    const response = await route.fetch();
    signalSetupReached();
    await heldSetupResponse;
    await route.fulfill({ response });
    signalSetupFulfilled();
  });
  await operator.getByRole('button', { name: 'Kurulumu denetle', exact: true }).click();
  await setupReached;
  const savedRequests = [];
  operator.on('request', (request) => {
    if (request.method() === 'PUT' && request.url() === operatorOrigin + '/api/operator/discord')
      savedRequests.push(request.postDataJSON());
  });
  await operator.getByLabel('Uygulama ID', { exact: true }).fill('111111111111111111');
  await operator.getByLabel('Test sunucusu ID’leri', { exact: true }).fill('222222222222222222');
  await operator
    .getByLabel('Bot token', { exact: true })
    .fill('fake-discord-token-for-local-browser-test');
  await operator
    .getByLabel('OAuth client secret', { exact: true })
    .fill('fake-client-secret-for-local-browser-test');
  await operator.getByRole('button', { name: 'Discord ayarlarını kaydet', exact: true }).click();
  await expect(operator.getByRole('status')).toContainText('Ayar kaydedildi.');
  releaseSetupResponse();
  await setupFulfilled;
  await operator.unroute('**/api/operator/setup-checks');
  await expect(
    operator.getByRole('button', { name: 'Destek raporunu indir', exact: true }),
  ).toBeDisabled();
  await expect(operator.locator('.setup-check-list')).toHaveCount(0);
  await expect(operator.getByLabel('Bot token', { exact: true })).toHaveValue('');
  await operator
    .getByLabel('OAuth client secret', { exact: true })
    .fill('fake-replacement-secret-for-local-browser-test');
  await operator.getByRole('button', { name: 'Discord ayarlarını kaydet', exact: true }).click();
  await expect.poll(() => savedRequests.length).toBe(2);
  expect(savedRequests[1].token).toBeUndefined();
  await expect(operator.getByLabel('OAuth client secret', { exact: true })).toHaveValue('');
  results.push(
    'Operator can replace only the OAuth secret without re-entering a saved bot token; no live connection is started',
  );
  await operator.getByRole('button', { name: 'Kurulumu denetle', exact: true }).click();
  await expect(operator.locator('.setup-check-list li')).toHaveCount(9);
  const configuredDownload = operator.waitForEvent('download');
  await operator.getByRole('button', { name: 'Destek raporunu indir', exact: true }).click();
  const configuredFile = await configuredDownload;
  const configuredReport = readFileSync(await configuredFile.path(), 'utf8');
  expect(configuredReport).not.toMatch(/fake-|111111111111111111|222222222222222222/);
  expect(JSON.parse(configuredReport).checks.find((c) => c.id === 'discord').state).toBe('pass');
  results.push(
    'Saving configuration invalidates old and in-flight reports; a fresh export excludes saved credentials and IDs',
  );
  await operator.goto(
    operatorOrigin + '/?test=oauth-error#auth-error=DISCORD_OAUTH_CLIENT_REJECTED',
  );
  await expect(operator.getByRole('alert')).toContainText('kayıtlı OAuth client secret');
  expect(await operator.evaluate(() => location.hash)).toBe('');
  expect(operatorErrors).toEqual([]);
  results.push(
    'OAuth failures return to a translated actionable message and clear the error fragment',
  );
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Your listening language', exact: true }),
  ).toContainText('English');
  await operator.reload();
  await expect(operator.getByRole('button', { name: 'Ayarlar', exact: true })).toBeVisible();
  results.push(
    'Demo and application cookies remain independent on the same localhost across different ports',
  );
  results.push(...(await validateCaptionTiming(browser, out)));
  results.push(...(await validateRoomRecovery(browser, out)));
  results.push(...(await validatePerformance(browser, out)));
  writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        status: 'passed',
        checks: results,
        browser: await browser.version(),
        liveDiscord: false,
        paidApi: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', checks: results.length, screenshots: out }));
} finally {
  await browser?.close();
  for (const child of children) child.kill();
}
