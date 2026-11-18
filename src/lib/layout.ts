/**
 * Layout discovery for arbitrary KV trees.
 *
 * OpenBao KV has no schema: a mount is just a path tree. This module infers a
 * logical view (project / environment / path-within-environment) from whatever
 * the server actually returns, using custom metadata first and path heuristics
 * second. Nothing is assumed about where "env" or "repo" sits in a path.
 */

export type LayoutKind = 'metadata' | 'legacy-env' | 'project-repo-env' | 'project-env-repo' | 'raw';

export interface LayoutProfile {
  kind: LayoutKind;
  /** Index of the environment segment in a project-relative path. -1 when unknown. */
  envIndex: number;
  /** Index of the component/repo segment, when the layout has one. -1 when unknown. */
  componentIndex: number;
  /** custom_metadata keys that carry the logical labels, when used. */
  metadataKeys: { project: string; env: string; component: string };
  /** Human-readable description of the inference. */
  description: string;
}

export interface ClassifiedSecret {
  /** Path relative to the KV metadata mount, e.g. "tgc/identity-service/development". */
  physical: string;
  project: string;
  env: string;
  /** Path within the environment, used by the rest of the console. */
  logical: string;
  component: string;
  source: 'metadata' | 'heuristic' | 'raw';
}

export interface InferenceResult {
  profile: LayoutProfile;
  classified: ClassifiedSecret[];
  unclassified: Array<{ physical: string; reason: string }>;
  warnings: string[];
}

const ENV_TOKENS = [
  'development', 'develop', 'dev', 'staging', 'stage', 'stg',
  'production', 'prod', 'live', 'qa', 'test', 'testing', 'sandbox',
  'preview', 'local', 'integration',
];
const REPO_TOKENS = ['repo', 'repos', 'repository', 'service', 'services', 'app', 'apps', 'component', 'components'] as const;
const MARKER_NAME = '__environment__';

export const ENVIRONMENT_MARKER = MARKER_NAME;

/** Metadata keys we understand. Teams can name theirs differently via `metadataKeys`. */
export const DEFAULT_METADATA_KEYS = {
  project: ['ph_project', 'project', 'ui_project'],
  env: ['ph_scope_tabs', 'environment', 'env', 'scope', 'ui_env'],
  component: ['ph_component_tabs', 'component', 'service', 'repo', 'ui_component'],
} as const;

const RAW_PROFILE: LayoutProfile = {
  kind: 'raw',
  envIndex: -1,
  componentIndex: -1,
  metadataKeys: { project: '', env: '', component: '' },
  description: 'Raw recursive listing — no environment or component could be inferred.',
};

function segmentsOf(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

function matchesToken(segment: string, tokens: readonly string[]): boolean {
  const value = segment.toLowerCase();
  return tokens.some((token) => value === token || value.startsWith(`${token}-`) || value.endsWith(`-${token}`));
}

export function isEnvironmentSegment(segment: string): boolean {
  return matchesToken(segment, ENV_TOKENS);
}

export function isComponentSegment(segment: string): boolean {
  return matchesToken(segment, REPO_TOKENS) || segment.toLowerCase() === 'env';
}

/** Servers often store these labels as a one-element JSON array, e.g. `["development"]`. */
function normalizeMetadataValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const first = parsed.find((item) => typeof item === 'string' && item.trim());
        return (typeof first === 'string' ? first : String(parsed[0] ?? '')).trim();
      }
    } catch {
      // Fall through and treat it as a plain comma-separated string.
    }
  }
  return trimmed.split(',')[0].trim();
}

function firstMetadataValue(
  custom: Record<string, string> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!custom) return undefined;
  for (const key of keys) {
    const value = custom[key];
    if (value) {
      const normalized = normalizeMetadataValue(value);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

/** Emit a warning at warning level and keep it for the UI. Never includes secret values. */
export function warnLayout(reason: string, warnings: string[]): void {
  const message = `[layout-discovery] ${reason}`;
  // eslint-disable-next-line no-console
  console.warn(message);
  warnings.push(reason);
}

/**
 * Infer a layout from discovered paths and any custom metadata read for them.
 * Paths are expected relative to the KV metadata mount (e.g. "tgc/identity-service/development").
 */
export function inferLayout(
  paths: string[],
  metadataByPath: Record<string, Record<string, string>> = {},
): InferenceResult {
  const warnings: string[] = [];
  const clean = [...new Set(paths.map((p) => p.replace(/^kv\/metadata\//, '').replace(/^\/+|\/+$/g, '')).filter(Boolean))];
  if (clean.length === 0) {
    return { profile: RAW_PROFILE, classified: [], unclassified: [], warnings };
  }

  const votes: Record<'legacy-env' | 'project-repo-env' | 'project-env-repo', number> = {
    'legacy-env': 0, 'project-repo-env': 0, 'project-env-repo': 0,
  };
  for (const path of clean) {
    const seg = segmentsOf(path);
    if (seg.length < 2) continue;
    if (seg[1] === 'env' && seg.length >= 4) votes['legacy-env'] += 1;
    else if (seg.length >= 3 && isEnvironmentSegment(seg[2])) votes['project-repo-env'] += 1;
    else if (isEnvironmentSegment(seg[1])) votes['project-env-repo'] += 1;
  }

  const best = (Object.entries(votes) as Array<[keyof typeof votes, number]>).sort((a, b) => b[1] - a[1])[0];
  const kind: LayoutKind = best && best[1] > 0 ? best[0] : 'raw';
  const profile: LayoutProfile = {
    kind,
    envIndex: kind === 'legacy-env' ? 2 : kind === 'project-repo-env' ? 2 : kind === 'project-env-repo' ? 1 : -1,
    componentIndex: kind === 'legacy-env' ? -1 : kind === 'project-repo-env' ? 1 : kind === 'project-env-repo' ? 2 : -1,
    metadataKeys: { ...DEFAULT_METADATA_KEYS, project: DEFAULT_METADATA_KEYS.project[0], env: DEFAULT_METADATA_KEYS.env[0], component: DEFAULT_METADATA_KEYS.component[0] },
    description: describeKind(kind),
  };

  const classified: ClassifiedSecret[] = [];
  const unclassified: Array<{ physical: string; reason: string }> = [];

  for (const path of clean) {
    const seg = segmentsOf(path);
    const custom = metadataByPath[path];
    const metaProject = firstMetadataValue(custom, DEFAULT_METADATA_KEYS.project);
    const metaEnv = firstMetadataValue(custom, DEFAULT_METADATA_KEYS.env);
    const metaComponent = firstMetadataValue(custom, DEFAULT_METADATA_KEYS.component);

    if (metaProject && metaEnv) {
      // Metadata is authoritative for labels; physical segments still give the logical path.
      const pathEnv = seg.find(isEnvironmentSegment);
      if (pathEnv && pathEnv.toLowerCase() !== metaEnv.toLowerCase()) {
        const reason = `Metadata environment "${metaEnv}" disagrees with path segment "${pathEnv}" in "${path}"; using the metadata value.`;
        warnLayout(reason, warnings);
      }
      classified.push({
        physical: path,
        project: metaProject,
        env: metaEnv,
        logical: logicalForMetadata(profile, seg, metaEnv),
        component: metaComponent ?? (profile.componentIndex >= 0 ? seg[profile.componentIndex] ?? '' : ''),
        source: 'metadata',
      });
      continue;
    }

    if (profile.envIndex < 0 || seg.length <= profile.envIndex || !isEnvironmentSegment(seg[profile.envIndex])) {
      const reason = `No environment-like segment found in "${path}"; falling back to the raw recursive listing.`;
      warnLayout(reason, warnings);
      unclassified.push({ physical: path, reason });
      classified.push({
        physical: path,
        project: seg[0] ?? 'other',
        env: '(unassigned)',
        logical: seg.slice(1).join('/'),
        component: '',
        source: 'raw',
      });
      continue;
    }

    const env = seg[profile.envIndex];
    const component = profile.componentIndex >= 0 && seg[profile.componentIndex] && seg[profile.componentIndex] !== env
      ? seg[profile.componentIndex]
      : '';
    const logical = logicalForProfile(profile, seg);

    if (!logical) {
      const reason = `Path "${path}" contains an environment but no secret name; it may be a folder placeholder.`;
      warnLayout(reason, warnings);
      unclassified.push({ physical: path, reason });
      continue;
    }

    if (metaEnv && metaEnv.toLowerCase() !== env.toLowerCase()) {
      const reason = `Metadata environment "${metaEnv}" disagrees with path segment "${env}" in "${path}"; using the metadata value.`;
      warnLayout(reason, warnings);
    }

    classified.push({
      physical: path,
      project: metaProject ?? seg[0],
      env: metaEnv ?? env,
      logical,
      component,
      source: metaEnv || metaProject ? 'metadata' : 'heuristic',
    });
  }

  if (kind === 'raw') {
    warnLayout('No layout pattern matched a majority of paths; using the raw recursive listing for all secrets.', warnings);
  }

  return { profile, classified, unclassified, warnings };
}

/** Extract the path-within-environment from a project-relative segment list. */
function logicalForProfile(profile: LayoutProfile, seg: string[]): string {
  if (profile.kind === 'legacy-env') return seg.slice(3).join('/');
  if (profile.kind === 'project-repo-env') return [seg[1], ...seg.slice(3)].filter(Boolean).join('/');
  return seg.slice(profile.envIndex >= 0 ? profile.envIndex + 1 : 1).join('/');
}

/** Metadata labels are authoritative, so strip an environment segment if it leaked into the logical path. */
function logicalForMetadata(profile: LayoutProfile, seg: string[], env: string): string {
  const logical = logicalForProfile(profile, seg);
  const parts = logical.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === env.toLowerCase());
  return index >= 0 ? parts.filter((_, position) => position !== index).join('/') : logical;
}

function describeKind(kind: LayoutKind): string {
  switch (kind) {
    case 'metadata': return 'custom_metadata labels';
    case 'legacy-env': return 'project / env / <environment> / path';
    case 'project-repo-env': return 'project / repo / <environment>';
    case 'project-env-repo': return 'project / <environment> / repo';
    case 'raw': return 'unclassified recursive tree';
  }
}

/** Physical path (relative to kv/metadata) for a logical secret in a project/environment. */
export function physicalPath(profile: LayoutProfile, project: string, env: string, logical: string): string {
  const clean = logical.replace(/^\/+|\/+$/g, '');
  if (profile.kind === 'legacy-env') return [project, 'env', env, clean].filter(Boolean).join('/');
  if (profile.kind === 'project-repo-env') {
    const [repo, ...rest] = clean.split('/');
    return [project, repo, env, ...rest].filter(Boolean).join('/');
  }
  return [project, env, clean].filter(Boolean).join('/');
}

/**
 * Physical path for an environment marker object, so an empty environment still
 * exists in KV. The marker is always the last segment so recursive listings can
 * hide it without knowing which layout pattern is in use.
 */
export function environmentMarkerPath(profile: LayoutProfile, project: string, env: string): string {
  if (profile.kind === 'legacy-env') return [project, 'env', env, MARKER_NAME].join('/');
  if (profile.kind === 'project-repo-env') return [project, MARKER_NAME, env, MARKER_NAME].join('/');
  return [project, env, MARKER_NAME].join('/');
}
