import { VERSION } from './contracts.js';

export type LocalSetupProbe =
  | { kind: 'python-missing' | 'worker-stopped' | 'worker-unavailable' | 'custom' }
  | { kind: 'worker-responding'; modelFiles: 'present' | 'missing' };
export type SetupReason =
  | 'node-supported'
  | 'node-unsupported'
  | LocalSetupProbe['kind']
  | 'models-present'
  | 'models-missing'
  | 'models-unchecked'
  | 'integrity-unchecked'
  | 'discord-configured'
  | 'discord-unconfigured'
  | 'discord-connected'
  | 'discord-disconnected'
  | 'https-configured'
  | 'loopback-only'
  | 'oauth-unchecked'
  | 'live-unchecked';
export interface SetupCheck {
  id:
    | 'node'
    | 'worker'
    | 'models'
    | 'integrity'
    | 'discord'
    | 'connection'
    | 'remote'
    | 'oauth'
    | 'live';
  state: 'pass' | 'blocked' | 'manual' | 'info';
  reason: SetupReason;
}
export interface SetupReport {
  schemaVersion: 1;
  scope: 'installation-snapshot';
  version: string;
  collectedAt: string;
  environment: { platform: string; architecture: string; node: string };
  checks: SetupCheck[];
}

/** Construct the export from an allowlist. Never serialize runtime/store/worker objects. */
export function setupReport(input: {
  node: string;
  platform: string;
  architecture: string;
  local: LocalSetupProbe;
  configured: boolean;
  connected: boolean;
  https: boolean;
}): SetupReport {
  const node = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.node) ? input.node : 'unknown';
  const [major, minor] = node.split('.').map(Number);
  const supported = major === 24 && minor !== undefined && minor >= 17;
  const local = input.local;
  return {
    schemaVersion: 1,
    scope: 'installation-snapshot',
    version: VERSION,
    collectedAt: new Date().toISOString(),
    environment: {
      platform: ['win32', 'linux', 'darwin'].includes(input.platform) ? input.platform : 'other',
      architecture: ['x64', 'arm64', 'ia32'].includes(input.architecture)
        ? input.architecture
        : 'other',
      node,
    },
    checks: [
      {
        id: 'node',
        state: supported ? 'pass' : 'blocked',
        reason: supported ? 'node-supported' : 'node-unsupported',
      },
      {
        id: 'worker',
        state:
          local.kind === 'worker-responding'
            ? 'pass'
            : local.kind === 'custom'
              ? 'manual'
              : 'blocked',
        reason: local.kind,
      },
      {
        id: 'models',
        state:
          local.kind === 'custom'
            ? 'manual'
            : local.kind === 'worker-responding' && local.modelFiles === 'present'
              ? 'pass'
              : 'blocked',
        reason:
          local.kind === 'worker-responding'
            ? local.modelFiles === 'present'
              ? 'models-present'
              : 'models-missing'
            : local.kind === 'custom'
              ? 'custom'
              : 'models-unchecked',
      },
      { id: 'integrity', state: 'manual', reason: 'integrity-unchecked' },
      {
        id: 'discord',
        state: input.configured ? 'pass' : 'blocked',
        reason: input.configured ? 'discord-configured' : 'discord-unconfigured',
      },
      {
        id: 'connection',
        state: input.connected ? 'pass' : 'blocked',
        reason: input.connected ? 'discord-connected' : 'discord-disconnected',
      },
      {
        id: 'remote',
        state: input.https ? 'info' : 'manual',
        reason: input.https ? 'https-configured' : 'loopback-only',
      },
      { id: 'oauth', state: 'manual', reason: 'oauth-unchecked' },
      { id: 'live', state: 'manual', reason: 'live-unchecked' },
    ],
  };
}
