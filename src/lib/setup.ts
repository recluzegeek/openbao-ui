import type { HealthResponse, SealStatusResponse } from './api';

/** Live state the getting-started guide reacts to, gathered from the standard API. */
export type SetupStage =
  | 'checking'
  | 'unreachable'
  | 'uninitialized'
  | 'sealed'
  | 'no-mount'
  | 'no-projects'
  | 'ready';

export interface SetupInput {
  health?: HealthResponse;
  healthFailed?: boolean;
  seal?: SealStatusResponse;
  kvMounted?: boolean;
  projects?: string[];
}

export function deriveSetupStage(input: SetupInput): SetupStage {
  if (input.healthFailed) return 'unreachable';
  if (!input.health) return 'checking';
  if (!input.health.initialized) return 'uninitialized';
  if (input.seal?.sealed) return 'sealed';
  if (input.kvMounted === false) return 'no-mount';
  if (input.projects === undefined) return 'checking';
  return input.projects.length === 0 ? 'no-projects' : 'ready';
}

/**
 * Operator-run CLI commands for each setup step. They never contain secret values:
 * `operator init` produces keys on the server, and the console never displays or
 * stores that output. Copy these into a terminal, not into a ticket.
 */
export const setupSnippets = {
  init: 'bao operator init -key-shares=1 -key-threshold=1',
  unseal: 'bao operator unseal   # repeat with a distinct key until Unsealed: true',
  enableKv: 'bao secrets enable -path=kv -version=2 kv',
  createSecret: 'bao kv put kv/my-project/env/development/web USER=demo PORT=8080',
  seedDemo: './scripts/seed.sh   # from the console repo, with BAO_TOKEN set',
} as const;

const ONBOARDING_KEY = 'console.onboarding';

interface OnboardingState {
  seen?: boolean;
  dismissed?: boolean;
}

function read(): OnboardingState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ONBOARDING_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as OnboardingState) : {};
  } catch {
    return {};
  }
}

function write(state: OnboardingState): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    // Storage may be denied; onboarding memory is best-effort.
  }
}

export function isOnboardingComplete(): boolean {
  return read().seen === true;
}

export function completeOnboarding(): void {
  write({ ...read(), seen: true, dismissed: true });
}

export function isOnboardingDismissed(): boolean {
  const state = read();
  return state.dismissed === true || state.seen === true;
}

export function dismissOnboarding(): void {
  write({ ...read(), dismissed: true });
}

export function resetOnboarding(): void {
  write({ seen: false, dismissed: false });
}

/** Live shortcut definitions, shared by the global handler and the help dialog. */
export interface Shortcut {
  keys: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: '⌘K / Ctrl+K', label: 'Open the command palette' },
  { keys: 'Alt+1 … Alt+8', label: 'Jump to a sidebar section' },
  { keys: '/', label: 'Open search' },
  { keys: '?', label: 'Show this shortcut help' },
  { keys: '↑ / ↓', label: 'Move through palette results' },
  { keys: 'Enter', label: 'Open the selected result' },
  { keys: 'Esc', label: 'Close a dialog or the palette' },
];
