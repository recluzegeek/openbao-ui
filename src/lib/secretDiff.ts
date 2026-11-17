import type { AuditEntry } from './audit';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'same';

export interface FieldDiff {
  key: string;
  status: DiffStatus;
  left?: string;
  right?: string;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Compare two KV v2 secret payloads field by field. Left is the older version in the UI. */
export function diffData(left: Record<string, unknown>, right: Record<string, unknown>): FieldDiff[] {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.map((key) => {
    const inLeft = Object.prototype.hasOwnProperty.call(left, key);
    const inRight = Object.prototype.hasOwnProperty.call(right, key);
    if (!inLeft) return { key, status: 'added', right: text(right[key]) };
    if (!inRight) return { key, status: 'removed', left: text(left[key]) };
    const leftValue = text(left[key]);
    const rightValue = text(right[key]);
    return {
      key,
      status: leftValue === rightValue ? 'same' : 'changed',
      left: leftValue,
      right: rightValue,
    };
  });
}

/** Attribute a KV version timestamp to the closest matching audit entry. */
export function actorForVersion(entries: AuditEntry[], createdTime: string, toleranceMs = 180_000): string | undefined {
  const stamp = new Date(createdTime).getTime();
  if (Number.isNaN(stamp)) return undefined;
  const writes = entries.filter((entry) => /^(create|update)$/.test(entry.operation ?? ''));
  let best: { entry: AuditEntry; delta: number } | undefined;
  for (const entry of writes) {
    const time = new Date(entry.time).getTime();
    if (Number.isNaN(time)) continue;
    const delta = Math.abs(stamp - time);
    if (delta <= toleranceMs && (!best || delta < best.delta)) best = { entry, delta };
  }
  return best?.entry.displayName ?? best?.entry.policies?.[0];
}
