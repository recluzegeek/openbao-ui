import { useQuery } from '@tanstack/react-query';
import { bao } from './api';
import {
  metadataPath,
  secretApiPath,
  secretPath,
  totpCodePath,
  totpKeyPath,
} from './baoPaths';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => bao.listProjects(),
    staleTime: 60_000,
  });
}

export function useEnvironments(project?: string) {
  return useQuery({
    queryKey: ['environments', project],
    queryFn: () => (project ? bao.listEnvironments(project) : []),
    enabled: Boolean(project),
    staleTime: 60_000,
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
  return useQuery({
    queryKey: ['secret-paths', project, env],
    queryFn: () => bao.listSecretPaths(project!, env!),
    enabled: Boolean(project && env),
    staleTime: 30_000,
  });
}

export function useSecret(project?: string, env?: string, service?: string, version?: number) {
  return useQuery({
    queryKey: ['secret', project, env, service, version ?? 'latest'],
    queryFn: () => bao.readSecret(secretApiPath(project!, env!, service!), version),
    enabled: Boolean(project && env && service),
    staleTime: 15_000,
  });
}

export function useSecretMetadata(project?: string, env?: string, service?: string) {
  return useQuery({
    queryKey: ['secret-metadata', project, env, service],
    queryFn: () => bao.readMetadata(secretApiPath(project!, env!, service!)),
    enabled: Boolean(project && env && service),
    staleTime: 30_000,
  });
}

export function useCapabilities(paths: string[]) {
  const key = [...paths].sort().join('|');
  return useQuery({
    queryKey: ['capabilities', key],
    queryFn: () => bao.capabilities(paths).then((res) => res.data),
    enabled: paths.length > 0,
    staleTime: 60_000,
  });
}

export function capabilityPathsForSecret(project?: string, env?: string, service?: string, allEnvs: string[] = []) {
  if (!project || !env || !service) return [];
  return [
    metadataPath(project),
    secretPath(project, env, service),
    // Probe path for "New secret": ACL wildcards answer the same as a real new path.
    `kv/data/${project}/env/${env}/__new__`,
    ...allEnvs.filter((e) => e !== env).map((e) => secretPath(project, e, service)),
    ...allEnvs.map((e) => `kv/metadata/${project}/env/${e}/`),
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
export function capabilityPathsForFolder(project?: string, env?: string, folder = '', allPaths: string[] = []) {
  if (!project || !env) return [];
  const metaBase = `kv/metadata/${project}/env/${env}`;
  const dataBase = `kv/data/${project}/env/${env}`;
  const folders = new Set<string>(folder ? [folder] : ['']);
  for (const path of allPaths) {
    const slash = path.lastIndexOf('/');
    if (slash !== -1) folders.add(path.slice(0, slash));
  }
  return [
    `${metaBase}/`,
    ...[...folders].map((name) => `${metaBase}/${name}/`),
    `${dataBase}/${folder}/__new__`,
    `${metaBase}/${folder}/__new__`,
    ...allPaths.map((path) => `${dataBase}/${path}`),
    ...allPaths.map((path) => `${metaBase}/${path}`),
  ];
}

export function runbookCapabilityPaths(projects: string[]) {
  return [
    'kv/metadata/_runbooks/',
    ...projects.map((project) => `kv/data/_runbooks/${project}`),
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
