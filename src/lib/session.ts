import { useEffect, useState } from 'react';
import { secondsUntil } from './format';

/** A token's remaining lease, or null when it never expires (root / periodic). */
export function sessionSecondsLeft(
  expireTime: string | undefined | null,
  ttl: number | undefined,
  now = Date.now(),
): number | null {
  if (!expireTime && (ttl === undefined || ttl === 0)) return null;
  if (expireTime) return secondsUntil(expireTime, now);
  return Math.max(0, ttl ?? 0);
}

/** Ticks once a second so the session countdown stays current without a refetch. */
export function useSessionCountdown(expireTime?: string | null, ttl?: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return sessionSecondsLeft(expireTime, ttl, now);
}
