import type { CapabilitiesMap } from './api';

export function can(map: CapabilitiesMap | undefined, path: string, capability: string): boolean {
  if (!map) return false;
  const caps = map[path] ?? map[path.replace(/\/$/, '')] ?? [];
  return caps.includes('root') || caps.includes(capability) || caps.includes('sudo');
}

export function deniedReason(map: CapabilitiesMap | undefined, path: string, capability: string): string {
  if (!map) return 'Checking your permissions…';
  const caps = map[path] ?? map[path.replace(/\/$/, '')];
  if (!caps || caps.length === 0 || caps.every((cap) => cap === 'deny')) return 'Your token has no access to this path.';
  if (caps.includes('root')) return 'Your token has full access to this path.';
  return `Your token can ${caps.join(', ')} here; ${capability} is not allowed.`;
}
