import { resolveApiPath, resolveEnvMetadataPath } from './layoutResolver';

export const KV_MOUNT = 'kv';

export function secretPath(project: string, env: string, service: string): string {
  return `${KV_MOUNT}/data/${secretApiPath(project, env, service)}`;
}

export function secretApiPath(project: string, env: string, service: string): string {
  return resolveApiPath(project, env, service);
}

export function metadataPath(project: string): string {
  return `${KV_MOUNT}/metadata/${project}/`;
}

export function envMetadataPath(project: string, env: string): string {
  return `${KV_MOUNT}/metadata/${resolveEnvMetadataPath(project, env)}/`;
}

export function totpCodePath(account: string): string {
  return `totp/code/${account}`;
}

export function totpKeyPath(account: string): string {
  return `totp/keys/${account}`;
}

/** Runbooks are a documented convention outside the project layout resolver. */
export function runbookMetadataPath(project: string): string {
  return `${KV_MOUNT}/metadata/_runbooks/${project}`;
}

export function runbookApiPath(project: string): string {
  return `${KV_MOUNT}/data/_runbooks/${project}`;
}

export function parseTotpAccount(account: string): { project: string; account: string } {
  const separator = account.indexOf('--');
  if (separator === -1) return { project: 'other', account };
  return { project: account.slice(0, separator), account: account.slice(separator + 2) };
}

export function envTone(env: string): 'development' | 'staging' | 'production' | 'other' {
  const normalized = env.toLowerCase();
  if (normalized.includes('dev')) return 'development';
  if (normalized.includes('stag')) return 'staging';
  if (normalized.includes('prod') || normalized.includes('live')) return 'production';
  return 'other';
}

export function envRank(a: string, b: string): number {
  const order = ['development', 'staging', 'production'];
  const ai = order.indexOf(a.toLowerCase());
  const bi = order.indexOf(b.toLowerCase());
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
