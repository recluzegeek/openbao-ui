import { useQuery } from '@tanstack/react-query';
import { bao, type KVDeletedVersion } from './api';
import {
  envMetadataPath,
  metadataPath,
  runbookApiPath,
  runbookMetadataPath,
  secretApiPath,
  secretPath,
  totpCodePath,
  totpKeyPath,
} from './baoPaths';
import { environmentMarkerPath, ENVIRONMENT_MARKER, inferLayout, type ClassifiedSecret, type LayoutProfile } from './layout';
import { registerProjectLayout } from './layoutResolver';
import { deriveSetupStage } from './setup';

const METADATA_SAMPLE = 80;

function logicalParent(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * A sibling path used to probe create capability. When discovery found a path
 * in this folder, derive the physical parent from it; otherwise fall back to
 * the legacy `<project>/env/<env>/...` probe.
 */
export function capabilityProbePath(project: string, env: string, allPaths: string[], folder = ''): string {
  const representative = allPaths.find((path) => logicalParent(path) === folder)
    ?? allPaths.find((path) => (folder ? path.startsWith(`${folder}/`) : true))
    ?? '';
  const fallback = [project, 'env', env, folder, '__new__'].filter(Boolean).join('/');
  if (!representative) return fallback;
  const physical = secretApiPath(project, env, representative);
  const parts = physical.split('/').filter(Boolean);
  // In project/repo/env layouts the last segment of a leaf path is the env.
  if (parts[parts.length - 1] === env) return `${physical}/__new__`;
  parts[parts.length - 1] = '__new__';
  return parts.join('/');
}

export interface LayoutDiscovery {
  profile: LayoutProfile;
  /** Secret paths only; environment markers are excluded. */
  classified: ClassifiedSecret[];
  /** Includes empty environments represented only by a marker. */
  environments: string[];
  warnings: string[];
  unclassified: Array<{ physical: string; reason: string }>;
  rawPaths: string[];
  markers: string[];
}

/**
 * Recursively lists the project's KV tree, samples custom metadata, and infers
 * the logical layout. When inference cannot classify a path it is still
 * returned in rawPaths and the reason is logged at warning level by inferLayout.
 */
/** Shared by the Secrets page and Search so every feature uses one resolver. */
export async function fetchLayoutDiscovery(project: string): Promise<LayoutDiscovery> {
  const allPaths = await bao.listRecursive(`${project}/`);
  const isMarker = (path: string) => path.slice(path.lastIndexOf('/') + 1) === ENVIRONMENT_MARKER;
  const markers = allPaths.filter(isMarker);
  const rawPaths = allPaths.filter((path) => !isMarker(path));
  const metadataByPath: Record<string, Record<string, string>> = {};
  // Markers carry the environment metadata, so sample them before secrets.
  for (const path of [...markers, ...rawPaths].slice(0, METADATA_SAMPLE)) {
    try {
      const meta = await bao.readMetadata(path);
      if (meta.data.custom_metadata) metadataByPath[path] = meta.data.custom_metadata;
    } catch {
      // Metadata may be unreadable for this token; heuristics still apply.
    }
  }
  const result = inferLayout(allPaths, metadataByPath);
  const classified = result.classified.filter((secret) => !isMarker(secret.physical));
  const environments = [...new Set(result.classified.map((secret) => secret.env))];
  registerProjectLayout(project, result.profile, classified);
  return { ...result, classified, environments, rawPaths, markers };
}

export function useLayoutDiscovery(project?: string) {
  return useQuery<LayoutDiscovery>({
    queryKey: ['layout-discovery', project],
    enabled: Boolean(project),
    staleTime: 120_000,
    retry: false,
    queryFn: () => fetchLayoutDiscovery(project!),
  });
}

/** Environment names derived from discovery, with the legacy listing as fallback. */
export function useEnvironments(project?: string) {
  const discovery = useLayoutDiscovery(project);
  return useQuery<string[]>({
    queryKey: ['environments', project, discovery.data?.profile.kind ?? 'pending'],
    queryFn: async () => {
      if (discovery.data?.environments.length) return discovery.data.environments;
      return project ? bao.listEnvironments(project) : [];
    },
    enabled: Boolean(project) && (discovery.isSuccess || discovery.isError),
    staleTime: 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => bao.listProjects(),
    staleTime: 60_000,
  });
}

/** Lightweight server-state probes used by the getting-started guide. */
export function useSetupHealth() {
  return useQuery({ queryKey: ['setup-health'], queryFn: () => bao.health(), retry: false, staleTime: 10_000 });
}

export function useSetupSeal() {
  return useQuery({ queryKey: ['setup-seal'], queryFn: () => bao.sealStatus(), retry: false, staleTime: 10_000 });
}

export function useKvMount() {
  return useQuery({ queryKey: ['setup-kv-mount'], queryFn: () => bao.hasKvMount(), retry: false, staleTime: 60_000 });
}

/** One derived setup stage so the guide, banner and sidebar agree. */
export function useSetupStage() {
  const health = useSetupHealth();
  const seal = useSetupSeal();
  const kv = useKvMount();
  const projects = useProjects();
  return deriveSetupStage({
    health: health.data,
    healthFailed: health.isError,
    seal: seal.data,
    kvMounted: kv.data,
    projects: projects.data,
  });
}

export function useServices(project?: string, env?: string) {
  return useQuery({
    queryKey: ['services', project, env],
    queryFn: () => (project && env ? bao.listServices(project, env) : []),
    enabled: Boolean(project && env),
    staleTime: 30_000,
  });
}

export function useCredentials(project?: string) {
  return useQuery({
    queryKey: ['credentials', project],
    queryFn: () => (project ? bao.listCreds(project) : []),
    enabled: Boolean(project),
    staleTime: 60_000,
  });
}

export function useSecretPaths(project?: string, env?: string) {
  const discovery = useLayoutDiscovery(project);
  return useQuery<string[]>({
    queryKey: ['secret-paths', project, env, discovery.data?.profile.kind ?? 'pending'],
    queryFn: async () => {
      if (discovery.data?.classified.length) {
        return [...new Set(
          discovery.data.classified
            .filter((secret) => secret.env === env && secret.logical)
            .map((secret) => secret.logical),
        )];
      }
      return project && env ? bao.listSecretPaths(project, env) : [];
    },
    enabled: Boolean(project && env) && (discovery.isSuccess || discovery.isError),
    staleTime: 30_000,
  });
}

/** Physical path + capabilities for the privilege-gated "new environment" action. */
export function environmentCreationTarget(project: string | undefined, env: string, discovery: LayoutDiscovery | undefined) {
  if (!project || !env.trim()) return null;
  const profile = discovery?.profile;
  if (!profile) return null;
  const physical = environmentMarkerPath(profile, project, env.trim());
  return {
    physical,
    dataPath: `kv/data/${physical}`,
    metadataPath: `kv/metadata/${physical}`,
  };
}

export function useSecret(project?: string, env?: string, service?: string, version?: number) {
  // The resolver is registered by discovery. Reading before it settles would
  // hit the legacy fallback path and surface a false "Not Found" on reload.
  const discovery = useLayoutDiscovery(project);
  const ready = Boolean(project && env && service) && (discovery.isSuccess || discovery.isError);
  return useQuery({
    queryKey: ['secret', project, env, service, version ?? 'latest', discovery.data?.profile.kind ?? 'pending'],
    queryFn: () => bao.readSecret(secretApiPath(project!, env!, service!), version),
    enabled: ready,
    staleTime: 15_000,
  });
}

export function useSecretMetadata(project?: string, env?: string, service?: string) {
  const discovery = useLayoutDiscovery(project);
  const ready = Boolean(project && env && service) && (discovery.isSuccess || discovery.isError);
  return useQuery({
    queryKey: ['secret-metadata', project, env, service, discovery.data?.profile.kind ?? 'pending'],
    queryFn: () => bao.readMetadata(secretApiPath(project!, env!, service!)),
    enabled: ready,
    staleTime: 30_000,
  });
}

/**
 * Soft-deleted versions across a project, built from KV metadata only — never
 * reads version data, so a Trash view cannot surface a secret value. Capped and
 * batched so a large mount cannot freeze the browser.
 */
export function useProjectTrash(project?: string) {
  const discovery = useLayoutDiscovery(project);
  return useQuery<KVDeletedVersion[]>({
    queryKey: ['project-trash', project, discovery.data?.profile.kind ?? 'pending'],
    enabled: Boolean(project) && (discovery.isSuccess || discovery.isError),
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const paths = [...new Set(
        discovery.data?.classified.map((secret) => secret.physical).filter(Boolean) ?? [],
      )].slice(0, 300);
      const found: KVDeletedVersion[] = [];
      for (let index = 0; index < paths.length; index += 12) {
        const chunk = paths.slice(index, index + 12);
        const results = await Promise.allSettled(
          chunk.map((path) => bao.readMetadata(path).then((meta) => ({ path, meta }))),
        );
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { path, meta } = result.value;
          for (const [version, info] of Object.entries(meta.data.versions ?? {})) {
            if (info.deletion_time && !info.destroyed) {
              found.push({
                path,
                version: Number(version),
                deletionTime: info.deletion_time,
                createdTime: info.created_time,
              });
            }
          }
        }
      }
      return found.sort((a, b) => b.deletionTime.localeCompare(a.deletionTime));
    },
  });
}

export function useCapabilities(paths: string[]) {
  const key = [...paths].sort().join('|');
  return useQuery({
    queryKey: ['capabilities', key],
    queryFn: () => bao.capabilities(paths).then((res) => res.data),
    enabled: paths.length > 0,
    staleTime: 60_000,
    // Fail closed immediately; global 5xx/network retries kept action buttons
    // disabled for seconds on every page load.
    retry: false,
  });
}

/** Every ACL path a single secret's actions can touch, including version lifecycle. */
export function lifecycleCapabilityPaths(physical: string): string[] {
  return [
    `kv/data/${physical}`,
    `kv/metadata/${physical}`,
    `kv/delete/${physical}`,
    `kv/undelete/${physical}`,
    `kv/destroy/${physical}`,
  ];
}

export function capabilityPathsForSecret(project?: string, env?: string, service?: string, allEnvs: string[] = []) {
  if (!project || !env || !service) return [];
  return [
    metadataPath(project),
    secretPath(project, env, service),
    // Probe path for "New secret": ACL wildcards answer the same as a real new path.
    `kv/data/${capabilityProbePath(project, env, [], '')}`,
    ...lifecycleCapabilityPaths(secretApiPath(project, env, service)),
    ...allEnvs.filter((e) => e !== env).map((e) => secretPath(project, e, service)),
    ...allEnvs.map((e) => envMetadataPath(project, e)),
  ];
}

export function useRunbookProjects() {
  return useQuery({
    queryKey: ['runbook-projects'],
    queryFn: () => bao.listRunbooks(),
    staleTime: 60_000,
  });
}

export function useRunbook(project?: string) {
  return useQuery({
    queryKey: ['runbook', project],
    queryFn: () => bao.readRunbook(project!),
    enabled: Boolean(project),
    staleTime: 30_000,
  });
}

/** Capabilities needed for folder browsing, secret reads, creates and metadata writes. */
export function capabilityPathsForFolder(
  project?: string,
  env?: string,
  folder = '',
  allPaths: string[] = [],
  allEnvs: string[] = [],
) {
  if (!project || !env) return [];
  const probe = capabilityProbePath(project, env, allPaths, folder);
  const physicalDirs = new Set<string>();
  for (const path of allPaths) {
    const physical = secretApiPath(project, env, path);
    const slash = physical.lastIndexOf('/');
    if (slash > 0) physicalDirs.add(`${physical.slice(0, slash)}/`);
  }
  return [
    envMetadataPath(project, env),
    ...[...physicalDirs].map((dir) => `kv/metadata/${dir}`),
    `kv/data/${probe}`,
    `kv/metadata/${probe}`,
    ...allPaths.map((path) => secretPath(project, env, path)),
    ...allPaths.flatMap((path) => lifecycleCapabilityPaths(secretApiPath(project, env, path))),
    ...allEnvs.filter((name) => name !== env).map((name) => envMetadataPath(project, name)),
  ];
}

export function runbookCapabilityPaths(projects: string[]) {
  return [
    'kv/metadata/_runbooks/',
    ...projects.flatMap((project) => [runbookApiPath(project), runbookMetadataPath(project)]),
  ];
}

export function useAuditTrail(path?: string) {
  return useQuery({
    queryKey: ['audit-trail', path],
    queryFn: () => bao.auditTrail(path!),
    enabled: Boolean(path),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** Larger metadata-only window for the full audit viewer. */
export function useAuditLog(limit = 500) {
  return useQuery({
    queryKey: ['audit-log', limit],
    queryFn: () => bao.auditTrail('', limit),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useTotpAccounts() {
  return useQuery({
    queryKey: ['totp-accounts'],
    queryFn: () => bao.listTotpAccounts(),
    staleTime: 30_000,
  });
}

export function useTotpCode(account?: string) {
  return useQuery({
    queryKey: ['totp-code', account],
    queryFn: () => bao.readTotpCode(account!),
    enabled: Boolean(account),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useTotpKey(account?: string) {
  return useQuery({
    queryKey: ['totp-key', account],
    queryFn: () => bao.readTotpKey(account!),
    enabled: Boolean(account),
    staleTime: 60_000,
  });
}

export function totpCapabilityPaths(accounts: string[]) {
  return accounts.flatMap((account) => [totpCodePath(account), totpKeyPath(account)]);
}

export function usePolicies() {
  return useQuery({ queryKey: ['acl-policies'], queryFn: () => bao.listPolicies(), staleTime: 60_000 });
}

export function usePolicy(name?: string) {
  return useQuery({
    queryKey: ['acl-policy', name],
    queryFn: () => bao.readPolicy(name!),
    enabled: Boolean(name),
    staleTime: 30_000,
  });
}

export function useEntities() {
  return useQuery({ queryKey: ['entities'], queryFn: () => bao.listEntities(), staleTime: 60_000 });
}

export function useAuthMethods() {
  return useQuery({ queryKey: ['auth-methods'], queryFn: () => bao.listAuthMethods(), staleTime: 60_000 });
}

/** Paths checked to decide whether policy editing and simulation are available. */
export function accessCapabilityPaths() {
  return [
    'sys/policies/acl/',
    'sys/policies/acl/__new__',
    'identity/entity/name/',
    'auth/token/create',
    'sys/auth/',
  ];
}
