export function mask(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length === 0 ? '—' : '•'.repeat(Math.min(Math.max(text.length, 6), 18));
}

export function formatWhen(iso?: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const delta = Date.now() - date.getTime();
  if (delta >= 0 && delta < 60_000) return 'just now';
  if (delta >= 0 && delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta >= 0 && delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTtl(seconds?: number): string {
  if (seconds === undefined) return 'unknown';
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function secondsUntil(value?: string | number, now = Date.now()): number {
  if (value === undefined || value === null || value === '') return 0;
  // OpenBao's TOTP secrets engine returns a Unix timestamp in seconds.
  const target = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : new Date(value).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

export function parsePeriod(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 30;
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function envFile(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `${key}=${shellQuote(value === null || value === undefined ? '' : String(value))}`)
    .join('\n');
}
