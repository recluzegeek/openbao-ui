import { bao, BaoError, getBaoConfig } from './api';
import { inferLayout, ENVIRONMENT_MARKER } from './layout';
import { folderOf } from './navigationMemory';
import { normalizeSearch, searchTokens } from './searchMatch';

/**
 * A client-side index of **paths and field names only**. It never reads secret
 * data: field names come from KV v2 `custom_metadata.fields`, written on every
 * save by the console. No value is ever held in memory, logged or persisted.
 */
export interface IndexEntry {
  /** Logical path inside the environment, e.g. `backend/db`. */
  path: string;
  project: string;
  env: string;
  folder: string;
  name: string;
  fields: string[];
  updatedAt: number;
}

export interface IndexStatus {
  state: 'idle' | 'building' | 'ready';
  done: number;
  total: number;
  builtAt: number;
}

export interface IndexScope {
  project?: string;
  env?: string;
  folder?: string;
}

export interface IndexHit {
  entry: IndexEntry;
  /** Set when the match came from a field name instead of the secret name. */
  field?: string;
  score: number;
}

const MAX_PATHS = 4000;
const LIST_CONCURRENCY = 5;
const STALE_MS = 5 * 60_000;

function storageKey(address: string, token: string, namespace: string): string {
  // A short, one-way fingerprint is enough to separate sessions; the token
  // itself is never stored in the index key or its payload.
  let hash = 2166136261;
  for (const char of `${namespace}\0${token}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `console.searchIndex.${address}.${(hash >>> 0).toString(36)}`;
}

function parseFields(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const text = raw.trim();
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))];
      }
    } catch {
      // Fall through to the comma-separated form.
    }
  }
  return [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
}

function updatedTime(meta: { updated_time?: string; versions?: Record<string, { created_time: string }> }): number {
  const raw = meta.updated_time
    ?? Object.values(meta.versions ?? {}).map((version) => version.created_time).sort().at(-1)
    ?? '';
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function isListable(path: string, glob: RegExp | null): boolean {
  if (!glob) return true;
  return glob.test(`kv/metadata/${path}`) || glob.test(`kv/data/${path}`);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** `true` when there is no useful ACL data, in which case we walk everything. */
async function aclGlob(signal: AbortSignal): Promise<RegExp | null> {
  try {
    const acl = await bao.resultantAcl(signal);
    const patterns = [
      ...Object.entries(acl.data.exact_paths ?? {}).filter(([, caps]) => caps.some((cap) => /^(read|list)$/.test(cap))).map(([path]) => path),
      ...Object.entries(acl.data.glob_paths ?? {}).filter(([, caps]) => caps.some((cap) => /^(read|list)$/.test(cap))).map(([path]) => path),
    ];
    return patterns.length ? new RegExp(`^(?:${patterns.map(globToRegExp).map((re) => re.source.replace(/^\^|\$$/g, '')).join('|')})$`) : null;
  } catch {
    return null;
  }
}

function preserveTrailingSlash(keys: string[]): { folders: string[]; leaves: string[] } {
  const folders = keys.filter((key) => key.endsWith('/')).map((key) => key.replace(/^\/+|\/+$/g, ''));
  const leaves = keys.filter((key) => !key.endsWith('/')).map((key) => key.replace(/^\/+|\/+$/g, ''));
  return { folders, leaves };
}

/** LIST walk that keeps the folder/leaf distinction OpenBao returns. */
async function listTree(prefix: string, signal: AbortSignal, allowed: RegExp | null, out: string[], seen: Set<string>): Promise<void> {
  if (signal.aborted || out.length >= MAX_PATHS) return;
  if (prefix && !isListable(prefix, allowed)) return;
  const path = `kv/metadata/${prefix}${prefix ? '/' : ''}`;
  let keys: string[] | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await bao.list(path, signal);
      keys = result.data?.keys ?? [];
      break;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof BaoError && error.status === 403) return;
      if (error instanceof BaoError && error.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      return;
    }
  }
  if (!keys) return;
  const { folders, leaves } = preserveTrailingSlash(keys);
  for (const leaf of leaves) {
    if (out.length < MAX_PATHS && !seen.has(leaf)) {
      seen.add(leaf);
      out.push(prefix ? `${prefix}/${leaf}` : leaf);
    }
  }
  const workers = [...folders];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(LIST_CONCURRENCY, workers.length) }, async () => {
    while (next < workers.length && !signal.aborted && out.length < MAX_PATHS) {
      const child = workers[next++];
      await listTree(child, signal, allowed, out, seen);
    }
  }));
}

function scoreMatch(text: string, query: string): number {
  const target = normalizeSearch(text);
  const tokens = searchTokens(query);
  if (!tokens.length || !tokens.every((token) => target.includes(token))) return 0;
  let worst = 3;
  for (const token of tokens) {
    if (target === token) continue;
    worst = Math.min(worst, target.startsWith(token) ? 2 : 1);
  }
  return worst;
}

class SearchIndexStore {
  private entries: IndexEntry[] = [];
  private status: IndexStatus = { state: 'idle', done: 0, total: 0, builtAt: 0 };
  // useSyncExternalStore requires a stable snapshot between changes.
  private statusSnapshot: IndexStatus = this.status;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private projects: string[] = [];
  private key = '';
  private sessionKey = '';
  private abortCount = 0;
  private buildPromise: Promise<void> | null = null;

  constructor() {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as Window & { __searchIndex?: unknown }).__searchIndex = {
        status: () => ({ ...this.status, entries: this.entries.length, aborted: this.abortCount }),
        refresh: () => this.refresh(),
        clear: () => this.clear(),
      };
    }
  }

  getStatus(): IndexStatus { return this.statusSnapshot; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() { for (const listener of this.listeners) listener(); }

  private setStatus(patch: Partial<IndexStatus>) {
    this.status = { ...this.status, ...patch };
    this.statusSnapshot = this.status;
    this.emit();
  }

  private persist() {
    try {
      if (this.sessionKey) window.sessionStorage.setItem(this.sessionKey, JSON.stringify({ entries: this.entries, builtAt: this.status.builtAt }));
    } catch {
      // Storage is best-effort; memory stays authoritative.
    }
  }

  private restore(): boolean {
    try {
      const raw = this.sessionKey && window.sessionStorage.getItem(this.sessionKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { entries?: IndexEntry[]; builtAt?: number };
      if (!Array.isArray(parsed.entries)) return false;
      this.entries = parsed.entries.filter((entry) => entry && typeof entry.path === 'string' && typeof entry.project === 'string');
      this.status = { state: 'ready', done: this.entries.length, total: this.entries.length, builtAt: parsed.builtAt ?? Date.now() };
      this.statusSnapshot = this.status;
      return true;
    } catch {
      return false;
    }
  }

  /** Called after login and whenever the readable project list changes. */
  start(projects: string[]) {
    const config = getBaoConfig();
    if (!config.token) return;
    const key = storageKey(config.address, config.token, config.namespace);
    if (key !== this.key) {
      this.clear();
      this.key = key;
      this.sessionKey = key;
      if (this.restore() && Date.now() - this.status.builtAt < STALE_MS) return;
      // Restored but stale: show it immediately and rebuild in the background.
    }
    this.projects = projects.length ? projects : this.projects;
    if (this.status.state === 'building') return;
    if (this.status.builtAt && Date.now() - this.status.builtAt < STALE_MS) return;
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.buildPromise) return this.buildPromise;
    this.controller?.abort();
    if (this.controller) this.abortCount += 1;
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus({ state: 'building', done: 0, total: 0 });
    this.buildPromise = this.build(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.controller === controller) this.controller = null;
        this.buildPromise = null;
        if (!controller.signal.aborted) this.setStatus({ state: 'ready', builtAt: Date.now() });
      });
    return this.buildPromise;
  }

  private async build(signal: AbortSignal): Promise<void> {
    const allowed = await aclGlob(signal);
    const physical: string[] = [];
    await listTree('', signal, allowed, physical, new Set<string>());
    if (signal.aborted) return;

    const paths = physical.filter((path) => !path.split('/').includes(ENVIRONMENT_MARKER));
    const metadataByPath: Record<string, Record<string, string>> = {};
    const fieldsByPath: Record<string, string[]> = {};
    const timeByPath: Record<string, number> = {};
    let cursor = 0;
    const workers = Array.from({ length: Math.min(LIST_CONCURRENCY, Math.max(1, paths.length)) }, async () => {
      while (cursor < paths.length && !signal.aborted) {
        const path = paths[cursor++];
        try {
          const meta = (await bao.readMetadata(path, signal)).data;
          if (meta.custom_metadata) metadataByPath[path] = meta.custom_metadata;
          fieldsByPath[path] = parseFields(meta.custom_metadata?.fields);
          timeByPath[path] = updatedTime(meta);
        } catch (error) {
          if (!(error instanceof BaoError) || error.status !== 403) {
            // Unreadable metadata means no field names, not a failed build.
          }
        }
        if (!signal.aborted) this.setStatus({ done: cursor, total: paths.length });
      }
    });
    await Promise.all(workers);
    if (signal.aborted) return;

    const classified = inferLayout(physical, metadataByPath).classified
      .filter((item) => item.physical !== ENVIRONMENT_MARKER && !item.physical.split('/').includes(ENVIRONMENT_MARKER));
    const next: IndexEntry[] = classified.map((item) => ({
      project: item.project,
      env: item.env,
      path: item.logical,
      folder: folderOf(item.logical),
      name: item.logical.slice(item.logical.lastIndexOf('/') + 1),
      fields: fieldsByPath[item.physical] ?? [],
      updatedAt: timeByPath[item.physical] ?? 0,
    }));
    this.entries = next;
    this.setStatus({ done: next.length, total: next.length });
    this.persist();
  }

  search(query: string, scope: IndexScope = {}): IndexHit[] {
    if (!searchTokens(query).length) return [];
    const hits: IndexHit[] = [];
    for (const entry of this.entries) {
      if (scope.project && entry.project !== scope.project) continue;
      if (scope.env && entry.env !== scope.env) continue;
      if (scope.folder !== undefined && entry.folder !== scope.folder) continue;
      const nameScore = scoreMatch(entry.name, query) * 2;
      if (nameScore) {
        hits.push({ entry, score: nameScore });
        continue;
      }
      const field = entry.fields.find((key) => scoreMatch(key, query) > 0);
      if (field) hits.push({ entry, field, score: scoreMatch(field, query) });
    }
    return hits.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt || a.entry.path.localeCompare(b.entry.path));
  }

  upsert(entry: IndexEntry) {
    const id = (item: IndexEntry) => `${item.project}\0${item.env}\0${item.path}`;
    const at = this.entries.findIndex((item) => id(item) === id(entry));
    if (at === -1) this.entries.unshift(entry);
    else this.entries[at] = entry;
    this.persist();
    this.emit();
  }

  remove(path: string, target?: Pick<IndexEntry, 'project' | 'env'>) {
    this.entries = this.entries.filter((entry) =>
      !(entry.path === path && (!target || (entry.project === target.project && entry.env === target.env))));
    this.persist();
    this.emit();
  }

  backfill(target: Pick<IndexEntry, 'project' | 'env' | 'path'>, fields: string[], updatedAt = Date.now()) {
    const existing = this.entries.find((entry) =>
      entry.project === target.project && entry.env === target.env && entry.path === target.path);
    if (existing?.fields.length === fields.length && existing.fields.every((field, index) => field === fields[index])) return;
    this.upsert({
      ...existing,
      ...target,
      folder: folderOf(target.path),
      name: target.path.slice(target.path.lastIndexOf('/') + 1),
      fields,
      updatedAt: existing?.updatedAt ?? updatedAt,
    });
  }

  clear() {
    this.controller?.abort();
    if (this.controller) this.abortCount += 1;
    this.controller = null;
    this.buildPromise = null;
    if (this.sessionKey) {
      try { window.sessionStorage.removeItem(this.sessionKey); } catch { /* best effort */ }
    }
    this.entries = [];
    this.projects = [];
    this.sessionKey = '';
    this.setStatus({ state: 'idle', done: 0, total: 0, builtAt: 0 });
  }
}

export const searchIndex = new SearchIndexStore();
