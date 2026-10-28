import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLauncherServer } from '../dist/launcher/server.js';
import { VERSION } from '../dist/core/contracts.js';
import { root } from './runtime.mjs';

// Dependency injection is confined to this test; the shipped entry point has no fixture mode.
const out = path.join(root, 'artifacts/launcher');
await mkdir(out, { recursive: true });
const status = { version: VERSION, state: 'idle', phase: 'package', simulation: true };
let preparations = 0,
  stops = 0,
  quits = 0;
const installer = {
  status,
  async prepare() {
    preparations++;
    Object.assign(status, {
      state: 'installing',
      phase: 'python',
      bytes: 5,
      total: 10,
      file: 'Synthetic runtime',
      error: undefined,
    });
  },
  pause() {
    status.state = 'paused';
  },
  async launch() {
    Object.assign(status, {
      state: 'running',
      operatorUrl: 'http://127.0.0.1:4347/#operator=synthetic-only',
    });
  },
  async stop() {
    stops++;
    status.state = 'ready';
  },
};
const token = randomBytes(32).toString('hex');
const service = await createLauncherServer({
  webRoot: path.join(root, 'dist/web'),
  token,
  installer,
  quit: () => {
    quits++;
  },
});
let browser;
const checks = [];
try {
  const origin = await service.app.listen({ host: '127.0.0.1', port: 0 });
  service.setOrigin(origin);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (req) => requests.push(req.url()));
  await page.goto(`${origin}/install#setup=${token}`);
  await expect(page.getByRole('button', { name: 'Kurulumu hazırla', exact: true })).toBeDisabled();
  await expect(page.getByText('Sentetik arayüz testi; gerçek kurulum yapılmıyor.')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(preparations).toBe(0);
  const cookies = await context.cookies();
  expect(
    cookies.some((c) => c.name.startsWith('vb_launcher_') && c.httpOnly && c.sameSite === 'Strict'),
  ).toBe(true);
  checks.push(
    'No setup before explicit download consent; URL capability removed and HttpOnly/Strict cookie established',
  );
  await page.screenshot({ path: path.join(out, 'windows-setup-tr.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile(path.join(out, 'accessibility.json'), JSON.stringify(axe.violations, null, 2));
  expect(axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  checks.push('Exercised desktop setup passes automatic WCAG A/AA rules (not certification)');
  await page
    .getByRole('switch', { name: 'Kurulum dosyalarını indirmeyi kabul ediyorum', exact: true })
    .click();
  await page.getByRole('button', { name: 'Kurulumu hazırla', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '5');
  await expect(page.getByText('50% · 0.0 / 0.0 MB')).toBeVisible();
  await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Kontrol et ve devam et', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Kontrol et ve devam et', exact: true }).click();
  expect(preparations).toBe(2);
  checks.push(
    'Per-file progress, pause, retained consent and resume control follow installer state',
  );
  Object.assign(status, { state: 'failed', error: 'DOWNLOAD_INTEGRITY' });
  await expect(page.getByRole('alert')).toContainText('kontrol toplamı uyuşmuyor');
  await page.getByRole('combobox', { name: 'Arayüz dili', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('alert')).toContainText('checksum did not match');
  Object.assign(status, { state: 'ready', error: undefined });
  await expect(page.getByRole('button', { name: 'Start VoiceBridge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start VoiceBridge', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open Discord settings' })).toHaveAttribute(
    'href',
    status.operatorUrl,
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(stops).toBe(1);
  checks.push(
    'Actionable checksum failure, English interface, private settings link and stop control',
  );
  await page.screenshot({ path: path.join(out, 'windows-setup-en.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'windows-setup-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  checks.push('390px setup has no horizontal overflow');
  await page.getByRole('button', { name: 'Close launcher', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close launcher', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close launcher', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Local services have closed');
  expect(quits).toBe(1);
  await page.waitForTimeout(1200);
  await expect(page.getByRole('alert')).toHaveCount(0);
  checks.push('Radix close dialog supports Escape/focus return; closed page stops polling');
  expect(errors).toEqual([]);
  expect(requests.every((u) => new URL(u).origin === origin)).toBe(true);
  checks.push('No browser errors, CSP violations or external network requests');
  const unauth = await browser.newContext();
  const denied = await unauth.newPage();
  await denied.goto(origin + '/install');
  await expect(denied.getByRole('alert')).toContainText('VoiceBridge.exe');
  await expect(
    denied.getByRole('button', { name: 'Kurulumu hazırla', exact: true }),
  ).toBeDisabled();
  checks.push('Fresh browser without private capability cannot operate setup');
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      { status: 'passed', version: VERSION, mode: 'synthetic-injected-installer', checks },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'passed', checks: checks.length }));
} finally {
  await browser?.close();
  await service.app.close();
}
