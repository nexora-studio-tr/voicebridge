import { z } from 'zod';
import { Mode } from './contracts.js';

const integer = z.number().int().nonnegative();
const distribution = z
  .object({ count: integer, p50Ms: integer.nullable(), p95Ms: integer.nullable() })
  .strict();
export const PerformanceReport = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal('process-performance'),
    version: z.string().max(50),
    collectedAt: z.string().datetime(),
    uptimeSeconds: integer,
    environment: z
      .object({ platform: z.string().max(20), architecture: z.string().max(20) })
      .strict(),
    nodeMemory: z.object({ residentMiB: integer, heapUsedMiB: integer }).strict(),
    queue: z
      .object({
        active: integer.max(1),
        waiting: integer.max(8),
        limit: z.literal(8),
        perSpeaker: z.literal(2),
      })
      .strict(),
    recent: z
      .object({
        windowMs: z.literal(300_000),
        sampleLimit: z.literal(512),
        sampleCount: integer.max(512),
        limited: z.boolean(),
        jobs: z
          .object({ completed: integer, failed: integer, canceled: integer, noOutput: integer })
          .strict(),
        rejected: integer,
        queueWait: distribution,
        outputs: z
          .array(z.object({ mode: Mode, caption: distribution, audio: distribution }).strict())
          .length(2),
      })
      .strict(),
  })
  .strict();
export type PerformanceReport = z.infer<typeof PerformanceReport>;
export type JobOutcome = 'completed' | 'failed' | 'canceled' | 'noOutput';
type Sample = { at: number } & (
  | { kind: 'queue'; ms: number }
  | { kind: 'caption' | 'audio'; ms: number; mode: 'local' | 'cloud' }
  | { kind: 'job'; outcome: JobOutcome }
  | { kind: 'rejected' }
);
type Measurement = Sample extends infer S ? (S extends Sample ? Omit<S, 'at'> : never) : never;

/** Numeric-only, bounded process aggregates. No room, user, audio, text or error payload enters here. */
export class PerformanceWindow {
  private samples: Sample[] = [];
  private lastEviction = -Infinity;
  constructor(private clock = () => performance.now()) {}
  record(sample: Measurement) {
    if ('ms' in sample && (!Number.isFinite(sample.ms) || sample.ms < 0)) return;
    const at = this.clock();
    this.prune(at);
    if (this.samples.length === 512) {
      this.samples.shift();
      this.lastEviction = at;
    }
    // Copy an explicit allowlist: even an untyped caller cannot retain an arbitrary payload.
    if (sample.kind === 'job') this.samples.push({ at, kind: 'job', outcome: sample.outcome });
    else if (sample.kind === 'rejected') this.samples.push({ at, kind: 'rejected' });
    else if (sample.kind === 'queue')
      this.samples.push({ at, kind: 'queue', ms: Math.floor(sample.ms) });
    else this.samples.push({ at, kind: sample.kind, mode: sample.mode, ms: Math.floor(sample.ms) });
  }
  private prune(at: number) {
    this.samples = this.samples.filter((s) => s.at > at - 300_000);
  }
  snapshot(): PerformanceReport['recent'] {
    const at = this.clock();
    this.prune(at);
    const summarize = (kind: 'queue' | 'caption' | 'audio', mode?: 'local' | 'cloud') => {
      const values = this.samples
        .flatMap((s) =>
          s.kind === kind && 'ms' in s && (!mode || ('mode' in s && s.mode === mode)) ? [s.ms] : [],
        )
        .sort((a, b) => a - b);
      const percentile = (p: number) =>
        values.length ? values[Math.ceil(values.length * p) - 1]! : null;
      return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
    };
    const jobs = { completed: 0, failed: 0, canceled: 0, noOutput: 0 };
    for (const s of this.samples) if (s.kind === 'job') jobs[s.outcome]++;
    return {
      windowMs: 300_000,
      sampleLimit: 512,
      sampleCount: this.samples.length,
      limited: this.lastEviction > at - 300_000,
      jobs,
      rejected: this.samples.filter((s) => s.kind === 'rejected').length,
      queueWait: summarize('queue'),
      outputs: (['local', 'cloud'] as const).map((mode) => ({
        mode,
        caption: summarize('caption', mode),
        audio: summarize('audio', mode),
      })),
    };
  }
}
