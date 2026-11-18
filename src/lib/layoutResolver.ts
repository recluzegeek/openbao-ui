import { physicalPath, type ClassifiedSecret, type LayoutProfile } from './layout';

/**
 * In-memory mapping from the console's logical (project / environment / path)
 * view onto the physical KV paths discovered on the current server.
 *
 * Registration is done by the discovery query before secrets are read, so the
 * existing path helpers keep working while pointing at the real server layout.
 * When a project has not been discovered yet, callers fall back to the legacy
 * `<project>/env/<env>/...` convention used by the seeded local instance.
 */
interface ProjectLayout {
  profile: LayoutProfile;
  logicalByPhysical: Map<string, string>;
  physicalByLogical: Map<string, string>;
}

const layouts = new Map<string, ProjectLayout>();

export function registerProjectLayout(project: string, profile: LayoutProfile, classified: ClassifiedSecret[]): void {
  const logicalByPhysical = new Map<string, string>();
  const physicalByLogical = new Map<string, string>();
  for (const secret of classified) {
    logicalByPhysical.set(secret.physical, secret.logical);
    physicalByLogical.set(`${secret.env}\0${secret.logical}`, secret.physical);
  }
  layouts.set(project, { profile, logicalByPhysical, physicalByLogical });
}

export function clearProjectLayouts(): void {
  layouts.clear();
}

export function hasProjectLayout(project: string): boolean {
  return layouts.has(project);
}

export function getProjectProfile(project: string): LayoutProfile | undefined {
  return layouts.get(project)?.profile;
}

/** Bare API path (without the kv/data prefix) for a logical secret. */
export function resolveApiPath(project: string, env: string, logical: string): string {
  const clean = logical.replace(/^\/+|\/+$/g, '');
  const layout = layouts.get(project);
  if (!layout) return `${project}/env/${env}/${clean}`.replace(/\/{2,}/g, '/');
  const known = layout.physicalByLogical.get(`${env}\0${clean}`);
  if (known) return known;
  return physicalPath(layout.profile, project, env, clean);
}

/** Bare metadata API path (without the kv/metadata prefix) for a logical secret. */
export function resolveMetadataApiPath(project: string, env: string, logical: string): string {
  return resolveApiPath(project, env, logical);
}

/** Bare metadata API path for listing an environment, with a trailing slash. */
export function resolveEnvMetadataPath(project: string, env: string): string {
  const layout = layouts.get(project);
  if (!layout || layout.profile.kind === 'legacy-env' || layout.profile.kind === 'raw') {
    return `${project}/env/${env}`;
  }
  if (layout.profile.kind === 'project-repo-env') return project;
  return `${project}/${env}`;
}

export function toLogicalPath(project: string, physical: string): string | undefined {
  return layouts.get(project)?.logicalByPhysical.get(physical.replace(/^kv\/metadata\//, ''));
}
