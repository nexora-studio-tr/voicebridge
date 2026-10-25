import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, same } from '../src/core/store.js';
import { temporary } from './helpers.js';
describe('encrypted configuration, sessions and conservative budget ledger', () => {
  let dir: ReturnType<typeof temporary>, store: Store, now: number;
  beforeEach(() => {
    dir = temporary();
    now = Date.parse('2026-10-25T12:00:00Z');
    store = new Store(dir.root, () => now);
  });
  afterEach(() => {
    store.close();
    dir.remove();
  });
  const policy = { enabled: true, daily: 100, monthly: 500, room: 200, user: 60 };
  it('never persists plaintext API keys and detects tampering', () => {
    store.set('provider', { key: 'a-very-private-test-key' });
    const row = store.db.prepare('SELECT value FROM config').get() as { value: string };
    expect(row.value).not.toContain('a-very-private');
    expect(store.get('provider')).toEqual({ key: 'a-very-private-test-key' });
    expect(() => store.unseal(row.value.slice(0, -4) + 'AAAA')).toThrow();
  });
  it('only persists a hash of the session bearer and consumes launch links once', () => {
    const s = store.createSession({ id: 'alice', name: 'Alice', operator: false });
    expect(store.db.prepare('SELECT id FROM sessions').get()?.id).not.toBe(s.id);
    expect(store.session(s.id)?.csrf).toBe(s.csrf);
    const link = store.issueOnce('operator', { test: true });
    expect(store.consumeOnce(link, 'oauth')).toBeNull();
    expect(store.consumeOnce(link, 'operator')).toEqual({ test: true });
    expect(store.consumeOnce(link, 'operator')).toBeNull();
  });
  it('expires idle sessions and launch links', () => {
    const s = store.createSession({ id: 'a', name: 'A', operator: false }),
      link = store.issueOnce('operator', {}, 1000);
    now += 3600_001;
    expect(store.session(s.id)).toBeNull();
    expect(store.consumeOnce(link, 'operator')).toBeNull();
  });
  it('compares untrusted unicode CSRF values without throwing', () => {
    expect(same('aa', 'éé')).toBe(false);
    expect(same('a', 'a')).toBe(true);
  });
  it('defaults to no cloud spending', () => {
    expect(() => store.reserve('1', 'g', 'r', 'u', 1)).toThrow('CLOUD_DISABLED');
  });
  it('enforces user, daily and guild isolation before requests dispatch', () => {
    store.setPolicy('g', policy);
    store.reserve('1', 'g', 'r', 'a', 60);
    expect(() => store.reserve('2', 'g', 'r', 'a', 1)).toThrow('BUDGET_EXHAUSTED');
    store.reserve('3', 'g', 'r', 'b', 40);
    expect(() => store.reserve('4', 'g', 'r', 'c', 1)).toThrow('BUDGET_EXHAUSTED');
    store.setPolicy('other', policy);
    store.reserve('5', 'other', 'r', 'a', 60);
    expect(store.summary('g').daily).toBe(100);
  });
  it('serializes multiple attempts against the same cap', async () => {
    store.setPolicy('g', { ...policy, user: 100 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => store.reserve(String(i), 'g', 'r', 'u', 30)),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(3);
    expect(store.summary('g').daily).toBe(90);
  });
  it('enforces room lifetime and monthly caps across UTC dates', () => {
    store.setPolicy('g', { ...policy, room: 70, user: 100 });
    store.reserve('1', 'g', 'r', 'a', 60);
    store.dispatch('1');
    store.settle('1', 60);
    now += 86400_000;
    expect(() => store.reserve('2', 'g', 'r', 'b', 11)).toThrow('BUDGET_EXHAUSTED');
    store.setPolicy('g', { ...policy, monthly: 65 });
    expect(() => store.reserve('3', 'g', 'r2', 'b', 6)).toThrow('BUDGET_EXHAUSTED');
  });
  it('does not refund timed out dispatched work, including after restart', () => {
    store.setPolicy('g', policy);
    store.reserve('1', 'g', 'r', 'a', 20);
    store.dispatch('1');
    store.release('1');
    store.reserve('2', 'g', 'r', 'a', 10);
    store.close();
    store = new Store(dir.root, () => now);
    expect(store.summary('g')).toMatchObject({ daily: 20, uncertain: 1 });
  });
  it('settles estimates and disables cloud on an unexpected overrun', () => {
    store.setPolicy('g', policy);
    store.reserve('1', 'g', 'r', 'a', 20);
    store.dispatch('1');
    store.settle('1', 25);
    expect(store.policy('g').enabled).toBe(false);
    expect(store.summary('g').daily).toBe(25);
  });
  it('rejects duplicate operations without changing the ledger', () => {
    store.setPolicy('g', policy);
    store.reserve('1', 'g', 'r', 'a', 20);
    expect(() => store.reserve('1', 'g', 'r', 'a', 20)).toThrow('DUPLICATE_OPERATION');
    expect(store.summary('g').daily).toBe(20);
  });
});
