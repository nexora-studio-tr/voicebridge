import { z } from 'zod';

export const VERSION = '0.1.0-alpha.2';
export const Language = z.enum(['tr', 'en']);
export type Language = z.infer<typeof Language>;
export const Mode = z.enum(['local', 'cloud']);
export type Mode = z.infer<typeof Mode>;
export const Snowflake = z.string().regex(/^\d{17,20}$/);
export const Preferences = z.object({
  language: Language.default('tr'),
  mode: Mode.default('local'),
  audio: z.boolean().default(false),
});
export type Preferences = z.infer<typeof Preferences>;
export const Consent = z
  .object({ local: z.boolean(), cloud: z.boolean(), language: Language })
  .refine((v) => !v.cloud || v.local, 'Local consent is required');
export type Consent = z.infer<typeof Consent>;
export const Prices = z.object({
  asrPerMinute: z.number().int().min(1).max(100_000_000),
  inputPerMillion: z.number().int().min(1).max(1_000_000_000),
  outputPerMillion: z.number().int().min(1).max(1_000_000_000),
  ttsPerMillion: z.number().int().min(1).max(1_000_000_000),
  verifiedAt: z.string().datetime(),
});
export type Prices = z.infer<typeof Prices>;
export const BudgetPolicy = z.object({
  enabled: z.boolean().default(false),
  daily: z.number().int().min(0).max(1_000_000_000).default(0),
  monthly: z.number().int().min(0).max(10_000_000_000).default(0),
  room: z.number().int().min(0).max(1_000_000_000).default(0),
  user: z.number().int().min(0).max(1_000_000_000).default(0),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicy>;
export const ProviderConfig = z.object({
  kind: z.literal('openai'),
  key: z.string().min(15).max(500),
  recognition: z.literal('gpt-transcribe'),
  translation: z.literal('gpt-realtime-2.1-mini'),
  speech: z.literal('gpt-realtime-2.1-mini'),
  voice: z
    .enum(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'])
    .default('marin'),
  prices: Prices,
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;
export const DiscordConfig = z.object({
  applicationId: Snowflake,
  token: z.string().min(20).max(300),
  clientSecret: z.string().min(15).max(300),
  guilds: z.array(Snowflake).min(1).max(10),
});
export type DiscordConfig = z.infer<typeof DiscordConfig>;

export interface Identity {
  id: string;
  name: string;
  operator: boolean;
}
export interface Member {
  id: string;
  name: string;
  guildId: string;
  guildName: string;
  channelId: string | null;
  channelName: string | null;
  admin: boolean;
}
export interface Speaker {
  id: string;
  name: string;
  consent: Consent;
  epoch: number;
  speaking: boolean;
}
export interface Caption {
  id: string;
  speakerId: string;
  speaker: string;
  source: string;
  text: string;
  sourceLanguage: Language;
  language: Language;
  mode: Mode;
  fallback: boolean;
  createdAt: number;
  latencyMs: number;
  audioUrl?: string;
}
export type Event =
  | { type: 'caption'; data: Caption }
  | { type: 'state' | 'status' | 'reset' | 'error'; data: Record<string, unknown> };
export interface Inference {
  recognize(wav: Buffer, language: Language, signal: AbortSignal): Promise<string>;
  translate(text: string, from: Language, to: Language, signal: AbortSignal): Promise<string>;
  speak(text: string, language: Language, signal: AbortSignal): Promise<Buffer>;
}
export interface Clock {
  now(): number;
}
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function check(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new Fault(code, status);
}
export const defaults = () => BudgetPolicy.parse({});
