/** Paths only — no secret values are ever stored in navigation memory. */
export interface SecretRef {
  project: string;
  env: string;
  path: string;
  key?: string;
  visitedAt: number;
}

const RECENT_KEY = 'console.recentSecrets';
const FAVORITE_KEY = 'console.favoriteSecrets';
const MAX_RECENT = 8;

function refId(ref: SecretRef): string {
  return `${ref.project}/${ref.env}/${ref.path}${ref.key ? `/${ref.key}` : ''}`;
}

function load(key: string, storage: Storage): SecretRef[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SecretRef =>
      Boolean(item && typeof item.project === 'string' && typeof item.env === 'string' && typeof item.path === 'string'));
  } catch {
    return [];
  }
}

function save(key: string, refs: SecretRef[], storage: Storage): void {
  try {
    storage.setItem(key, JSON.stringify(refs));
  } catch {
    // Browsers can deny storage; navigation memory is best-effort.
  }
}

export function loadRecent(storage: Storage = window.sessionStorage): SecretRef[] {
  return load(RECENT_KEY, storage).sort((a, b) => b.visitedAt - a.visitedAt);
}

export function pushRecent(ref: Omit<SecretRef, 'visitedAt'>, storage: Storage = window.sessionStorage): SecretRef[] {
  const now = Date.now();
  const next = [{ ...ref, visitedAt: now }, ...loadRecent(storage).filter((item) => refId(item) !== refId({ ...ref, visitedAt: now }))]
    .slice(0, MAX_RECENT);
  save(RECENT_KEY, next, storage);
  return next;
}

export function loadFavorites(storage: Storage = window.localStorage): SecretRef[] {
  return load(FAVORITE_KEY, storage);
}

export function toggleFavorite(ref: Omit<SecretRef, 'visitedAt'>, storage: Storage = window.localStorage): SecretRef[] {
  const current = loadFavorites(storage);
  const id = refId({ ...ref, visitedAt: 0 });
  const next = current.some((item) => refId(item) === id)
    ? current.filter((item) => refId(item) !== id)
    : [{ ...ref, visitedAt: Date.now() }, ...current];
  save(FAVORITE_KEY, next, storage);
  return next;
}

export function isFavorite(ref: Omit<SecretRef, 'visitedAt'>, favorites: SecretRef[]): boolean {
  const id = refId({ ...ref, visitedAt: 0 });
  return favorites.some((item) => refId(item) === id);
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function secretHref(ref: SecretRef): string {
  const folder = folderOf(ref.path);
  const params = new URLSearchParams({ project: ref.project, env: ref.env, service: ref.path });
  if (folder) params.set('folder', folder);
  return `/secrets?${params.toString()}`;
}
