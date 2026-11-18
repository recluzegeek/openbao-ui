import { bao } from './api';
import { secretApiPath } from './baoPaths';
import { fetchLayoutDiscovery } from './queries';

/**
 * The global search index stores **paths and field names only**. Values are read
 * transiently to learn the field names and are never kept, logged or persisted.
 */
export interface IndexedSecret {
  project: string;
  env: string;
  path: string;
  fields: string[];
}

export interface SearchIndex {
  secrets: IndexedSecret[];
  /** True when the server has more readable secrets than the index covers. */
  truncated: boolean;
  total: number;
  indexedAt: number;
  /** Secrets whose payload did not need re-reading thanks to the metadata cache. */
  reused: number;
}

export const SEARCH_INDEX_LIMIT = 80;

interface FieldCacheEntry {
  version: number;
  updatedAt: string;
  fields: string[];
}

/** Survives route changes in one tab; cleared on reload so it never outlives a session. */
const fieldCache = new Map<string, FieldCacheEntry>();

export function clearSearchIndexCache(): void {
  fieldCache.clear();
}

function cacheKey(target: { project: string; env: string; path: string }): string {
  return `${target.project}\0${target.env}\0${target.path}`;
}

async function indexOne(target: IndexedSecret): Promise<{ secret: IndexedSecret; reused: boolean } | null> {
  const key = cacheKey(target);
  const cached = fieldCache.get(key);
  const apiPath = secretApiPath(target.project, target.env, target.path);
  try {
    if (cached) {
      // Metadata is much cheaper than the payload. Only re-read the secret when
      // its version or update time moved.
      const meta = await bao.readMetadata(apiPath);
      const version = meta.data.current_version;
      const updatedAt = meta.data.updated_time ?? meta.data.versions?.[String(version)]?.created_time ?? '';
      if (version === cached.version && updatedAt === cached.updatedAt) {
        return { secret: { ...target, fields: cached.fields }, reused: true };
      }
    }
    const secret = await bao.readSecret(apiPath);
    const fields = Object.keys(secret.data.data);
    fieldCache.set(key, {
      version: secret.data.metadata.version,
      updatedAt: secret.data.metadata.created_time,
      fields,
    });
    return { secret: { ...target, fields }, reused: false };
  } catch {
    // Unreadable/deleted paths simply drop out of the index.
    return null;
  }
}

/**
 * Build (or refresh) the index from the same layout discovery the Secrets page
 * uses. Layout discovery results are cached by react-query, so a refresh only
 * pays for metadata reads plus payloads whose version changed.
 */
export async function buildSearchIndex(projects: string[]): Promise<SearchIndex> {
  const discoveries = await Promise.allSettled(projects.map((project) => fetchLayoutDiscovery(project)));
  const pairs: IndexedSecret[] = [];
  const seen = new Set<string>();

  for (const [index, project] of projects.entries()) {
    const discovery = discoveries[index];
    if (discovery.status !== 'fulfilled') continue;
    for (const secret of discovery.value.classified) {
      if (!secret.logical) continue;
      const key = `${project}\0${secret.env}\0${secret.logical}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ project, env: secret.env, path: secret.logical, fields: [] });
    }
  }

  const targets = pairs.slice(0, SEARCH_INDEX_LIMIT);
  const results = await Promise.all(targets.map((target) => indexOne(target)));
  const secrets: IndexedSecret[] = [];
  let reused = 0;
  for (const result of results) {
    if (!result) continue;
    secrets.push(result.secret);
    if (result.reused) reused += 1;
  }

  return {
    secrets,
    truncated: pairs.length > SEARCH_INDEX_LIMIT,
    total: pairs.length,
    indexedAt: Date.now(),
    reused,
  };
}
