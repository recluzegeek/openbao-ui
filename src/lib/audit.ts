export interface AuditEntry {
  time: string;
  operation?: string;
  path?: string;
  displayName?: string;
  policies?: string[];
  allowed?: boolean;
}

export interface AuditResponse {
  available: boolean;
  entries: AuditEntry[];
}

const OPERATION_LABELS: Record<string, string> = {
  create: 'created',
  update: 'changed',
  read: 'read',
  delete: 'deleted',
  list: 'listed',
  sudo: 'administered',
};

export function operationLabel(operation?: string): string {
  return operation ? (OPERATION_LABELS[operation] ?? operation) : 'requested';
}

export function actorLabel(entry: AuditEntry): string {
  if (entry.displayName) return entry.displayName;
  if (entry.policies?.length) return `token (${entry.policies.join(', ')})`;
  return 'unknown token';
}

/** Turns a KV data audit path back into a secrets-browser deep link (paths only, no values). */
export function auditPathHref(path?: string): string | null {
  const match = /^kv\/data\/([^/]+)\/env\/([^/]+)\/(.+)$/.exec(path ?? '');
  if (!match) return null;
  const [, project, env, rest] = match;
  const folder = rest.split('/').slice(0, -1).join('/');
  const params = new URLSearchParams({ project, env, service: rest });
  if (folder) params.set('folder', folder);
  return `/secrets?${params}`;
}

export type AuditRange = '15m' | '1h' | '24h' | 'all';

export interface AuditFilters {
  search: string;
  actor: string;
  operation: string;
  range: AuditRange;
}

export const AUDIT_RANGES: { id: AuditRange; label: string }[] = [
  { id: '15m', label: 'Last 15 minutes' },
  { id: '1h', label: 'Last hour' },
  { id: '24h', label: 'Last 24 hours' },
  { id: 'all', label: 'All loaded entries' },
];

const RANGE_MS: Record<Exclude<AuditRange, 'all'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

/** Client-side filters over the metadata-only audit bridge. Never touches secret values. */
export function filterAuditEntries(entries: AuditEntry[], filters: AuditFilters, now = Date.now()): AuditEntry[] {
  const needle = filters.search.trim().toLowerCase();
  const cutoff = filters.range === 'all' ? null : now - RANGE_MS[filters.range];
  return entries.filter((entry) => {
    if (filters.actor !== 'all' && actorLabel(entry) !== filters.actor) return false;
    if (filters.operation !== 'all' && (entry.operation ?? 'request') !== filters.operation) return false;
    if (cutoff !== null) {
      const time = Date.parse(entry.time);
      if (!Number.isFinite(time) || time < cutoff) return false;
    }
    if (needle) {
      const haystack = [entry.path ?? '', actorLabel(entry), entry.operation ?? '', ...(entry.policies ?? [])]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** CSV of metadata only — safe to copy into tickets. */
export function auditCsv(entries: AuditEntry[]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = entries.map((entry) => [
    entry.time,
    actorLabel(entry),
    entry.operation ?? 'request',
    entry.path ?? '',
    entry.allowed === undefined ? '' : entry.allowed ? 'allowed' : 'denied',
  ].map(cell).join(','));
  return ['time,actor,operation,path,result', ...rows].join('\n');
}
