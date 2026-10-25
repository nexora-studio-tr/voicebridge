import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import { BudgetPolicy, Fault, type Identity } from './contracts.js';

export const token = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export class Store {
  db: DatabaseSync;
  private key: Buffer;
  constructor(
    public root: string,
    public now = () => Date.now(),
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const keyPath = path.join(root, 'master.key');
    try {
      this.key = readFileSync(keyPath);
    } catch {
      this.key = randomBytes(32);
      writeFileSync(keyPath, this.key, { flag: 'wx', mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error('Invalid operator encryption key');
    this.db = new DatabaseSync(path.join(root, 'voicebridge.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL, touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS once(id TEXT PRIMARY KEY, purpose TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS budgets(guild TEXT PRIMARY KEY, policy TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,guild TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,day TEXT NOT NULL,month TEXT NOT NULL,reserved INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_day ON usage(guild,day);
      CREATE INDEX IF NOT EXISTS usage_month ON usage(guild,month);
      CREATE INDEX IF NOT EXISTS usage_actor ON usage(guild,actor,day);`);
    // A dispatched request may have been billed. Never refund it solely because the process restarted.
    this.db.exec(
      "UPDATE usage SET status='uncertain' WHERE status='dispatched'; UPDATE usage SET status='released',amount=0 WHERE status='reserved';",
    );
    this.prune();
  }
  close() {
    this.db.close();
  }
  seal(value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  unseal<T>(value: string): T {
    const b = Buffer.from(value, 'base64'),
      d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  }
  get<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM config WHERE key=?').get(key) as
      { value: string } | undefined;
    return r ? this.unseal<T>(r.value) : null;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO config VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, this.seal(value));
  }
  delete(key: string) {
    this.db.prepare('DELETE FROM config WHERE key=?').run(key);
  }
  createSession(user: Identity) {
    this.prune();
    const id = token(),
      csrf = token(),
      now = this.now();
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?,?)')
      .run(hash(id), JSON.stringify(user), csrf, now + 12 * 3600_000, now);
    this.db
      .prepare(
        'DELETE FROM sessions WHERE id IN (SELECT id FROM sessions ORDER BY touched DESC LIMIT -1 OFFSET 100)',
      )
      .run();
    return { id, csrf };
  }
  session(raw?: string) {
    if (!raw || raw.length > 150) return null;
    const r = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(hash(raw)) as
      { id: string; user: string; csrf: string; expires: number; touched: number } | undefined;
    if (!r || r.expires < this.now() || r.touched < this.now() - 3600_000) return null;
    this.db.prepare('UPDATE sessions SET touched=? WHERE id=?').run(this.now(), r.id);
    return { user: JSON.parse(r.user) as Identity, csrf: r.csrf, id: r.id };
  }
  revoke(raw: string) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(raw));
  }
  issueOnce(purpose: string, value: unknown, ttl = 600_000) {
    this.prune();
    const raw = token();
    this.db
      .prepare('INSERT INTO once VALUES(?,?,?,?)')
      .run(hash(raw), purpose, this.seal(value), this.now() + ttl);
    return raw;
  }
  consumeOnce<T>(raw: string, purpose: string): T | null {
    if (!raw || raw.length > 150) return null;
    const r = this.db
      .prepare('DELETE FROM once WHERE id=? AND purpose=? AND expires>? RETURNING value')
      .get(hash(raw), purpose, this.now()) as { value: string } | undefined;
    return r ? this.unseal<T>(r.value) : null;
  }
  policy(guild: string) {
    const r = this.db.prepare('SELECT policy FROM budgets WHERE guild=?').get(guild) as
      { policy: string } | undefined;
    return r ? BudgetPolicy.parse(JSON.parse(r.policy)) : BudgetPolicy.parse({});
  }
  setPolicy(guild: string, input: unknown) {
    const policy = BudgetPolicy.parse(input);
    this.db
      .prepare(
        'INSERT INTO budgets VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET policy=excluded.policy',
      )
      .run(guild, JSON.stringify(policy));
    return policy;
  }
  summary(guild: string) {
    const date = new Date(this.now()).toISOString(),
      day = date.slice(0, 10),
      month = date.slice(0, 7);
    const sum = (q: string, ...args: (string | number)[]) =>
      Number((this.db.prepare(q).get(...args) as { n: number }).n);
    return {
      daily: sum('SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND day=?', guild, day),
      monthly: sum(
        'SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND month=?',
        guild,
        month,
      ),
      uncertain: sum("SELECT count(*) n FROM usage WHERE guild=? AND status='uncertain'", guild),
      policy: this.policy(guild),
    };
  }
  reserve(id: string, guild: string, room: string, actor: string, amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Fault('PRICE_REQUIRED');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT id FROM usage WHERE id=?').get(id))
        throw new Fault('DUPLICATE_OPERATION', 409);
      const p = this.policy(guild),
        date = new Date(this.now()).toISOString(),
        day = date.slice(0, 10),
        month = date.slice(0, 7);
      if (!p.enabled) throw new Fault('CLOUD_DISABLED', 403);
      const sum = (sql: string, ...args: string[]) =>
        Number((this.db.prepare(sql).get(...args) as { n: number }).n);
      for (const [limit, used] of [
        [
          p.daily,
          sum('SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND day=?', guild, day),
        ],
        [
          p.monthly,
          sum(
            'SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND month=?',
            guild,
            month,
          ),
        ],
        [
          p.room,
          sum('SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND room=?', guild, room),
        ],
        [
          p.user,
          sum(
            'SELECT coalesce(sum(amount),0) n FROM usage WHERE guild=? AND actor=? AND day=?',
            guild,
            actor,
            day,
          ),
        ],
      ])
        if (used! + amount > limit!) throw new Fault('BUDGET_EXHAUSTED', 402);
      this.db
        .prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, guild, room, actor, day, month, amount, amount, 'reserved', this.now());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  dispatch(id: string) {
    this.db
      .prepare("UPDATE usage SET status='dispatched' WHERE id=? AND status='reserved'")
      .run(id);
  }
  settle(id: string, actual: number) {
    const r = this.db.prepare('SELECT reserved,guild FROM usage WHERE id=?').get(id) as
      { reserved: number; guild: string } | undefined;
    if (!r || !Number.isSafeInteger(actual) || actual < 0) throw new Fault('INVALID_USAGE');
    // Record real overruns rather than concealing a provider/pricing mismatch.
    this.db
      .prepare('UPDATE usage SET amount=?,status=? WHERE id=?')
      .run(actual, actual > r.reserved ? 'overrun' : 'complete', id);
    if (actual > r.reserved) this.setPolicy(r.guild, { ...this.policy(r.guild), enabled: false });
  }
  uncertain(id: string) {
    this.db
      .prepare("UPDATE usage SET status='uncertain' WHERE id=? AND status='dispatched'")
      .run(id);
  }
  release(id: string) {
    this.db
      .prepare("UPDATE usage SET status='released',amount=0 WHERE id=? AND status='reserved'")
      .run(id);
  }
  prune() {
    const now = this.now();
    this.db.prepare('DELETE FROM sessions WHERE expires<? OR touched<?').run(now, now - 3600_000);
    this.db.prepare('DELETE FROM once WHERE expires<?').run(now);
    this.db
      .prepare("DELETE FROM usage WHERE created<? AND status IN ('complete','released')")
      .run(now - 100 * 86400_000);
  }
}
