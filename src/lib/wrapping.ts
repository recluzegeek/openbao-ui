/**
 * One-time share links backed by OpenBao response wrapping.
 *
 * A wrapping token is a short-lived, single-use credential: unwrapping it
 * returns the wrapped response once and burns the token. The token is carried
 * in the URL *fragment* (`#wrap=...`) so it is never sent to the Vite proxy or
 * an HTTP server in the request line, and it is cleared from the URL after a
 * successful reveal. The token is never logged or persisted to storage.
 */

const FRAGMENT_KEY = 'wrap';

/** The credential-free metadata plus secret fields we put inside a wrap. */
export interface SharedSecretPayload {
  source: string;
  wrapped_at: string;
  data: Record<string, unknown>;
}

export function shareLinkFor(wrappingToken: string, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  return `${base}/unwrap#${FRAGMENT_KEY}=${encodeURIComponent(wrappingToken)}`;
}

/** Extract a wrapping token from a location hash such as `#wrap=hvs…`. */
export function wrappingTokenFromHash(hash?: string): string | null {
  const source = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const clean = source.startsWith('#') ? source.slice(1) : source;
  for (const pair of clean.split('&')) {
    const [key, value] = pair.split('=');
    if (key === FRAGMENT_KEY && value) {
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return null;
}

/** Remove the wrapping token from the address bar without adding a history entry. */
export function clearWrappingTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Human label for the wrap-TTL presets offered in the share dialog. */
export const WRAP_TTL_PRESETS = [
  { value: '5m', label: '5 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
] as const;

export const DEFAULT_WRAP_TTL = '1h';

/** Return true when a TTL string is a safe Go/OpenBao duration (digits + unit). */
export function validWrapTtl(value: string): boolean {
  return /^\d+(ns|us|µs|ms|s|m|h)$/.test(value.trim());
}
