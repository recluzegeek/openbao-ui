/**
 * KV mount discovery and version-aware API paths.
 *
 * The rest of the console follows a project/env layout on the conventional
 * `kv/` v2 mount. This module is the "universal base": given any KV mount the
 * server advertises, it builds the correct LIST / read / write paths for both
 * v2 (data + metadata endpoints) and v1 (a single data namespace).
 */

export interface KvMountInfo {
  /** Mount path without leading or trailing slashes, e.g. `kv` or `team-secrets`. */
  path: string;
  version: 1 | 2;
  description?: string;
}

export interface MountConfig {
  type?: string;
  options?: { version?: string } | null;
  description?: string;
}

/** Parse KV mounts out of `sys/mounts` or `sys/internal/ui/mounts`' `secret` map. */
export function kvMountsFromMap(map: Record<string, MountConfig> | undefined): KvMountInfo[] {
  return Object.entries(map ?? {})
    .filter(([, config]) => config?.type === 'kv')
    .map(([rawPath, config]): KvMountInfo => ({
      path: rawPath.replace(/^\/+|\/+$/g, ''),
      version: String(config.options?.version ?? '1') === '2' ? 2 : 1,
      description: config.description || undefined,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The conventional mount, used as the default so existing callers are unchanged. */
export const DEFAULT_KV_MOUNT: KvMountInfo = { path: 'kv', version: 2 };

/** Encode a logical secret path as slash-separated, individually encoded segments. */
function logicalPath(value: string): string {
  return value.split('/').map((part) => part.trim()).filter(Boolean).map(encodeURIComponent).join('/');
}

/** API path used to LIST the children of a folder (or the mount root). */
export function kvListPath(mount: KvMountInfo, logical = ''): string {
  const tail = logicalPath(logical);
  if (mount.version === 2) return tail ? `${mount.path}/metadata/${tail}/` : `${mount.path}/metadata/`;
  return tail ? `${mount.path}/${tail}/` : `${mount.path}/`;
}

/** API path used to READ or WRITE a secret value. */
export function kvDataPath(mount: KvMountInfo, logical: string): string {
  const tail = logicalPath(logical);
  if (mount.version === 2) return `${mount.path}/data/${tail}`;
  return `${mount.path}/${tail}`;
}

/** v1 has no versions, metadata, soft delete or CAS. */
export function kvSupportsVersions(mount: KvMountInfo): boolean {
  return mount.version === 2;
}

/** Where a read response puts the secret field map (v2 nests it one level deeper). */
export function kvDataField(mount: KvMountInfo): 'data.data' | 'data' {
  return mount.version === 2 ? 'data.data' : 'data';
}

export function kvMountLabel(mount: KvMountInfo): string {
  return `${mount.path}/ · KV v${mount.version}`;
}
