export type InstallPhase = 'package' | 'python' | 'environment' | 'dependencies' | 'models';
export type InstallState =
  'idle' | 'installing' | 'paused' | 'failed' | 'ready' | 'starting' | 'running';
export interface LauncherStatus {
  version: string;
  state: InstallState;
  phase: InstallPhase;
  bytes?: number;
  total?: number;
  file?: string;
  error?: string;
  freeBytes?: number;
  operatorUrl?: string;
  simulation?: boolean;
}
export interface Installer {
  status: LauncherStatus;
  prepare(): Promise<void>;
  pause(): void;
  launch(): Promise<void>;
  stop(): Promise<void>;
}
