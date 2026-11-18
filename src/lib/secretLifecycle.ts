/** KV v2 version lifecycle presentation helpers. Never handles secret values. */

export interface VersionMetaLike {
  created_time: string;
  deletion_time?: string;
  destroyed?: boolean;
}

export type VersionState = 'current' | 'older' | 'deleted' | 'destroyed';

/** Deleted versions still have recoverable data; destroyed ones do not. */
export function versionState(version: number, meta: VersionMetaLike, current?: number): VersionState {
  if (meta.destroyed) return 'destroyed';
  if (meta.deletion_time) return 'deleted';
  return current === version ? 'current' : 'older';
}

export function deletedVersions(
  versions: Record<string, VersionMetaLike>,
): Array<{ version: number; deletedAt: string; createdAt: string }> {
  return Object.entries(versions)
    .filter(([, meta]) => Boolean(meta.deletion_time) && !meta.destroyed)
    .map(([version, meta]) => ({
      version: Number(version),
      deletedAt: meta.deletion_time!,
      createdAt: meta.created_time,
    }))
    .sort((a, b) => b.version - a.version);
}

/** Go-style durations accepted by OpenBao, including compound forms like `1h30m`. */
const DURATION_PART = /^\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h|d)$/i;

export function durationError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '0' || trimmed === '0s') return null;
  const parts = trimmed.match(/\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h|d)?/gi) ?? [];
  if (parts.join('') !== trimmed || parts.some((part) => !DURATION_PART.test(part))) {
    return 'Use a duration like 30d, 12h or 1h30m.';
  }
  return null;
}

export function versionSettingsFrom(meta: {
  max_versions?: number;
  cas_required?: boolean;
  delete_version_after?: string;
}) {
  return {
    maxVersions: meta.max_versions ?? 0,
    casRequired: Boolean(meta.cas_required),
    deleteVersionAfter: meta.delete_version_after ?? '0s',
  };
}
