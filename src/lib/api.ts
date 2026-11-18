import type { AuditResponse } from './audit';
import { runbookApiPath } from './baoPaths';

const KEYS = {
  address: 'console.bao.address',
  token: 'console.bao.token',
  namespace: 'console.bao.namespace',
} as const;

export interface BaoConfig {
  address: string;
  token: string;
  namespace: string;
}

export class BaoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly apiPath: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BaoError';
  }

  withCause(cause: unknown): BaoError {
    return new BaoError(this.message, this.status, this.apiPath, cause);
  }
}

const defaultAddress =
  import.meta.env.VITE_BAO_ADDR ||
  (import.meta.env.DEV && typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8200');

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getBaoConfig(): BaoConfig {
  const s = store();
  return {
    address: s?.getItem(KEYS.address) || defaultAddress,
    token: s?.getItem(KEYS.token) || '',
    namespace: s?.getItem(KEYS.namespace) || '',
  };
}

export function setBaoConfig(patch: Partial<BaoConfig>): void {
  const s = store();
  if (!s) return;
  if (patch.address !== undefined) s.setItem(KEYS.address, patch.address.replace(/\/$/, ''));
  if (patch.token !== undefined) s.setItem(KEYS.token, patch.token);
  if (patch.namespace !== undefined) s.setItem(KEYS.namespace, patch.namespace);
}

export function clearBaoSession(): void {
  const s = store();
  s?.removeItem(KEYS.token);
  s?.removeItem(KEYS.namespace);
}

/**
 * Namespaces are path-like identifiers. Normalize what the user typed and
 * reject path traversal so an accidental keystroke cannot silently change
 * every request to a different namespace.
 */
export function normalizeNamespace(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error('Use letters, numbers, dot, dash or slash between namespace names.');
  }
  if (parts.some((part) => part.startsWith('.'))) {
    throw new Error('Namespace names cannot start with a dot.');
  }
  return trimmed;
}

export function isAuthenticated(): boolean {
  return Boolean(getBaoConfig().token);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: unknown;
  list?: boolean;
  params?: Record<string, string>;
  /** Allow the call without a token (health/seal status/login). */
  unauthenticated?: boolean;
  /** Override the token for one request, e.g. while testing a login. */
  token?: string;
  /** Override the request Content-Type (KV PATCH needs application/merge-patch+json). */
  contentType?: string;
  /** Extra headers, e.g. `X-Vault-Wrap-TTL` for response wrapping. Merged last. */
  headers?: Record<string, string>;
}

export async function request<T>(apiPath: string, options: RequestOptions = {}): Promise<T> {
  const config = getBaoConfig();
  const token = options.token ?? config.token;
  if (!token && !options.unauthenticated) {
    throw new BaoError('No OpenBao token. Sign in to continue.', 401, apiPath);
  }

  const url = new URL(`/v1/${apiPath.replace(/^\/+/, '')}`, config.address);
  if (options.list) url.searchParams.set('list', 'true');
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['X-Vault-Token'] = token;
  if (config.namespace) headers['X-Vault-Namespace'] = config.namespace;
  if (options.data !== undefined) headers['Content-Type'] = options.contentType ?? 'application/json';
  Object.assign(headers, options.headers ?? {});

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
    });
  } catch (cause) {
    throw new BaoError(
      `Cannot reach OpenBao at ${config.address}. Check the server address and CORS settings.`,
      0,
      apiPath,
    ).withCause(cause);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    // OpenBao returns 404 for an empty LIST. That is "no keys", not a failure
    // or a permission problem, and callers already handle `data: null`.
    if (options.list && response.status === 404) return { data: null } as T;
    const errors = (body as { errors?: string[] } | null)?.errors;
    const detail = errors?.length ? errors.join('; ') : response.statusText;
    throw new BaoError(detail || `Request failed (${response.status})`, response.status, apiPath);
  }
  return body as T;
}

/* ----------------------------- domain types ----------------------------- */

export type Capabilities = string[];
export type CapabilitiesMap = Record<string, Capabilities>;

export interface HealthResponse {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  version: string;
}

export interface SealStatusResponse {
  initialized: boolean;
  sealed: boolean;
  progress: number;
  t: number;
  n: number;
  version: string;
}

export interface LookupSelfResponse {
  data: {
    id?: string;
    name?: string;
    display_name?: string;
    policies?: string[];
    ttl?: number;
    renewable?: boolean;
    expire_time?: string;
    entity_id?: string;
    namespace?: { path?: string };
    meta?: Record<string, string>;
  };
}

export interface KVResponse {
  data: {
    data: Record<string, unknown>;
    metadata: {
      version: number;
      created_time: string;
      deletion_time?: string;
      destroyed?: boolean;
      custom_metadata?: Record<string, string>;
    };
  };
}

export interface KVMetadataResponse {
  data: {
    current_version: number;
    oldest_version?: number;
    /** 0 means "use the mount default" (normally 10 versions). */
    max_versions?: number;
    cas_required?: boolean;
    delete_version_after?: string;
    versions: Record<string, { created_time: string; deletion_time?: string; destroyed?: boolean }>;
    custom_metadata?: Record<string, string>;
  };
}

/** A soft-deleted version; data is still recoverable until it is destroyed. */
export interface KVDeletedVersion {
  /** Bare API path, e.g. `securus/backend/development/db`. */
  path: string;
  version: number;
  deletionTime: string;
  createdTime: string;
}

export interface ListResponse {
  data: { keys: string[] } | null;
}

export interface AclPolicyResponse {
  data: { name?: string; policy: string };
}

/** Effective policies, including those inherited from identity groups. */
export interface ResultantAclResponse {
  data: { policies?: string[] };
}

export interface AuthMethodSummary {
  path: string;
  type: string;
  accessor?: string;
}

/** Response wrapping (`bao -wrap-ttl`): a short-lived, single-use token. */
export interface WrapInfo {
  token: string;
  accessor?: string;
  ttl: number;
  creation_time?: string;
  creation_path?: string;
}

export interface WrapResponse {
  wrap_info: WrapInfo;
}

export interface UnwrapResponse {
  data: Record<string, unknown>;
  warnings?: string[] | null;
}

/** KV mount metadata from `sys/mounts` / `sys/internal/ui/mounts`. */
export interface MountSummary {
  path: string;
  type: string;
  version: 1 | 2;
  description?: string;
}

export interface EntitySummary {
  name: string;
  id?: string;
  policies: string[];
}

export interface TotpKeyResponse {
  data: {
    issuer?: string;
    account_name?: string;
    algorithm?: string;
    digits?: number | string;
    period?: number | string;
    key?: string;
  };
}

export interface TotpCodeResponse {
  data: {
    code: string;
    /** Unix timestamp in seconds (OpenBao TOTP engine) or ISO string. */
    expire_time: number | string;
    generated: number | boolean;
    period: number | string;
  };
}

/* ------------------------------ API facade ------------------------------ */

function cleanKeys(keys: string[] | undefined): string[] {
  return (keys ?? []).filter((key) => key.length > 0);
}

export const bao = {
  health: () => request<HealthResponse>('sys/health', { unauthenticated: true }),
  sealStatus: () => request<SealStatusResponse>('sys/seal-status', { unauthenticated: true }),
  unseal: (key: string) => request<SealStatusResponse>('sys/unseal', { method: 'PUT', data: { key }, unauthenticated: true }),

  lookupSelf: () => request<LookupSelfResponse>('auth/token/lookup-self'),
  resultantAcl: () => request<ResultantAclResponse>('sys/internal/ui/resultant-acl'),
  capabilities: (paths: string[]) =>
    request<{ data: CapabilitiesMap }>('sys/capabilities-self', { method: 'POST', data: { paths } }),
  loginUserpass: (username: string, password: string, mount = 'userpass') =>
    request<{ auth: { client_token: string } }>(`auth/${mount}/login/${encodeURIComponent(username)}`, {
      method: 'POST',
      data: { password },
      unauthenticated: true,
    }),
  /** Extend the current token's lease. Never logs or stores the token value. */
  renewSelf: (increment?: string | number) =>
    request<LookupSelfResponse>('auth/token/renew-self', {
      method: 'POST',
      data: increment === undefined ? {} : { increment },
    }),
  logout: () => request<void>('auth/token/revoke-self', { method: 'POST' }),

  /**
   * Wrap a response into a single-use token (CLI `bao -wrap-ttl`). The token is
   * short-lived and can be unwrapped exactly once. Never log or persist it.
   */
  wrapResponse: (data: unknown, ttl: string) =>
    request<WrapResponse>('sys/wrapping/wrap', {
      method: 'POST',
      data,
      headers: { 'X-Vault-Wrap-TTL': ttl },
    }),
  /** Consume a wrapping token once. The wrapping token authenticates this call. */
  unwrapResponse: (wrappingToken: string) =>
    request<UnwrapResponse>('sys/wrapping/unwrap', {
      method: 'POST',
      token: wrappingToken,
      data: {},
    }),

  list: (path: string) => request<ListResponse>(path, { list: true }),

  /** Best-effort namespace picker. A 403 means the token cannot enumerate them. */
  listNamespaces: async (): Promise<string[]> => {
    try {
      const res = await request<ListResponse>('sys/namespaces', { list: true });
      return cleanKeys(res.data?.keys).map((key) => key.replace(/\/$/, ''));
    } catch {
      return [];
    }
  },

  /**
   * Generic recursive KV listing — the same walk `bao kv list -recursive` does.
   * Returns full leaf paths relative to the metadata root, e.g.
   * "tgc/identity-service/development", even when a prefix is supplied.
   * Caps breadth and depth so a large mount cannot freeze the console.
   */
  listRecursive: async (prefix = '', maxPaths = 4000): Promise<string[]> => {
    const base = prefix.replace(/^\/+|\/+$/g, '');
    const seen = new Set<string>();
    const out: string[] = [];
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (depth > 12 || out.length >= maxPaths) return;
      const cleanRel = relative.replace(/^\/+|\/+$/g, '');
      const full = cleanRel ? `${base}/${cleanRel}` : base;
      if (seen.has(full)) return;
      seen.add(full);
      const listPath = full ? `kv/metadata/${full}/` : 'kv/metadata/';
      const res = await bao.list(listPath);
      for (const key of cleanKeys(res.data?.keys)) {
        if (out.length >= maxPaths) return;
        const child = cleanRel ? `${cleanRel}/${key}` : key;
        if (key.endsWith('/')) await walk(child, depth + 1);
        else out.push(`${full}/${key.replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/'));
      }
    };
    await walk('', 0);
    return out;
  },

  /** KV v2 mounts advertised by the server, so `kv/` is no longer assumed. */
  listKvMounts: async (): Promise<string[]> => {
    const res = await request<{ data?: Record<string, { type?: string; options?: { version?: string } }> }>('sys/mounts');
    return Object.entries(res.data ?? {})
      .filter(([, config]) => config?.type === 'kv' && config?.options?.version === '2')
      .map(([path]) => path.replace(/\/$/, ''));
  },

  listProjects: async () => {
    const res = await bao.list('kv/metadata/');
    return cleanKeys(res.data?.keys).map((k) => k.replace(/\/$/, ''));
  },
  listEnvironments: async (project: string) => {
    const res = await bao.list(`kv/metadata/${encodeURIComponent(project)}/env/`);
    return cleanKeys(res.data?.keys).map((k) => k.replace(/\/$/, ''));
  },
  listServices: async (project: string, env: string) => {
    const res = await bao.list(`kv/metadata/${encodeURIComponent(project)}/env/${encodeURIComponent(env)}/`);
    return cleanKeys(res.data?.keys).map((k) => k.replace(/\/$/, ''));
  },
  listCreds: async (project: string) => {
    const res = await bao.list(`kv/metadata/${encodeURIComponent(project)}/creds/`);
    return cleanKeys(res.data?.keys).map((k) => k.replace(/\/$/, ''));
  },
  /** Recursive KV v2 metadata listing, used to build the folder tree. */
  listSecretPaths: async (project: string, env: string) => {
    const base = `kv/metadata/${encodeURIComponent(project)}/env/${encodeURIComponent(env)}/`;
    const walk = async (prefix: string): Promise<string[]> => {
      const res = await bao.list(`${base}${prefix}`);
      const keys = cleanKeys(res.data?.keys);
      const out: string[] = [];
      for (const key of keys) {
        if (key.endsWith('/')) out.push(...await walk(`${prefix}${key}`));
        else out.push(`${prefix}${key}`);
      }
      return out;
    };
    return walk('');
  },
  listRunbooks: async () => {
    const res = await bao.list('kv/metadata/_runbooks/');
    return cleanKeys(res.data?.keys).map((k) => k.replace(/\/$/, ''));
  },
  readRunbook: (project: string) => request<KVResponse>(runbookApiPath(project)),
  readSecret: (path: string, version?: number) =>
    request<KVResponse>(`kv/data/${path}`, version ? { params: { version: String(version) } } : {}),
  readMetadata: (path: string) => request<KVMetadataResponse>(`kv/metadata/${path}`),
  /** Custom metadata (tags, comments, overrides) lives on the KV v2 metadata endpoint. */
  writeCustomMetadata: (path: string, customMetadata: Record<string, string>) =>
    request<void>(`kv/metadata/${path}`, { method: 'POST', data: { custom_metadata: customMetadata } }),
  writeSecret: (path: string, data: Record<string, unknown>, cas?: number) =>
    request<KVResponse>(`kv/data/${path}`, {
      method: 'POST',
      data: { data, options: cas === undefined ? {} : { cas } },
    }),
  /**
   * KV v2 JSON merge patch (same wire call as `bao kv patch`). Only the fields
   * we send are touched, so a concurrent edit to a different field cannot trip
   * a stale CAS conflict. Falls back to read-then-write when the token lacks
   * the `patch` capability (403) or the server is too old to support PATCH (405).
   */
  patchSecret: async (path: string, data: Record<string, unknown>, cas?: number) => {
    try {
      return await request<KVResponse>(`kv/data/${path}`, {
        method: 'PATCH',
        data: { data, options: cas === undefined ? {} : { cas } },
        contentType: 'application/merge-patch+json',
      });
    } catch (error) {
      if (!(error instanceof BaoError) || (error.status !== 403 && error.status !== 405)) throw error;
      const current = await bao.readSecret(path);
      const merged = { ...(current.data?.data ?? {}), ...data };
      return bao.writeSecret(path, merged, current.data?.metadata?.version);
    }
  },

  /* KV v2 version lifecycle. All paths are bare (the kv/ prefix is added here). */

  /** Soft-delete the latest version. It can be restored with undelete. */
  deleteLatestVersion: (path: string) =>
    request<void>(`kv/data/${path}`, { method: 'DELETE' }),
  /** Soft-delete specific versions (CLI: `bao kv delete -versions=...`). */
  softDeleteVersions: (path: string, versions: number[]) =>
    request<void>(`kv/delete/${path}`, { method: 'POST', data: { versions } }),
  /** Restore soft-deleted versions (CLI: `bao kv undelete -versions=...`). */
  undeleteVersions: (path: string, versions: number[]) =>
    request<void>(`kv/undelete/${path}`, { method: 'POST', data: { versions } }),
  /** Permanently remove version data (CLI: `bao kv destroy -versions=...`). */
  destroyVersions: (path: string, versions: number[]) =>
    request<void>(`kv/destroy/${path}`, { method: 'PUT', data: { versions } }),
  /** Permanently remove the key, all versions and its metadata. */
  deleteSecretMetadata: (path: string) =>
    request<void>(`kv/metadata/${path}`, { method: 'DELETE' }),
  /**
   * Update per-secret version settings without dropping annotations or other
   * settings. OpenBao's JSON merge-patch silently ignores zero values such as
   * `delete_version_after: "0s"` and `max_versions: 0`, so a PATCH cannot reset
   * a key to the mount defaults. Read the current metadata and issue a full
   * POST, preserving custom_metadata and every setting the caller omits.
   */
  patchMetadataSettings: async (
    path: string,
    settings: { max_versions?: number; cas_required?: boolean; delete_version_after?: string },
  ) => {
    const current = await bao.readMetadata(path);
    const existing = current.data;
    return request<void>(`kv/metadata/${path}`, {
      method: 'POST',
      data: {
        custom_metadata: existing.custom_metadata ?? {},
        max_versions: settings.max_versions ?? existing.max_versions ?? 0,
        cas_required: settings.cas_required ?? existing.cas_required ?? false,
        delete_version_after: settings.delete_version_after ?? existing.delete_version_after ?? '0s',
      },
    });
  },

  /**
   * Create an environment by writing a reserved marker secret at its physical
   * path, then attaching custom metadata to that path. CAS 0 makes creation
   * fail instead of overwriting an existing marker. No secret values are stored.
   */
  createEnvironment: async (path: string, customMetadata: Record<string, string>) => {
    await bao.writeSecret(path, { __console_environment_marker__: '1' }, 0);
    try {
      await bao.writeCustomMetadata(path, customMetadata);
    } catch (error) {
      // Leave no half-created environment if the token cannot write metadata.
      await request<void>(`kv/data/${path}`, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
  },

  listTotpAccounts: async () => {
    const res = await bao.list('totp/keys/');
    return cleanKeys(res.data?.keys);
  },
  readTotpKey: (name: string) => request<TotpKeyResponse>(`totp/keys/${encodeURIComponent(name)}`),
  readTotpCode: (name: string) => request<TotpCodeResponse>(`totp/code/${encodeURIComponent(name)}`),
  createTotpKey: (name: string, options: { issuer: string; accountName: string; period?: number; digits?: number }) =>
    request<TotpKeyResponse>(`totp/keys/${encodeURIComponent(name)}`, {
      method: 'POST',
      data: {
        generate: true,
        exported: false,
        issuer: options.issuer,
        account_name: options.accountName,
        ...(options.period ? { period: options.period } : {}),
        ...(options.digits ? { digits: options.digits } : {}),
      },
    }),
  deleteTotpKey: (name: string) =>
    request<void>(`totp/keys/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  /* ACL policies, identities and auth methods for the access console. */
  /** Whether a version-2 KV engine is mounted at `kv/` (setup-guide check). */
  hasKvMount: async () => {
    try {
      const res = await request<{ data?: { options?: { version?: string }; type?: string } }>('sys/mounts/kv');
      return res.data?.type === 'kv' && res.data?.options?.version === '2';
    } catch (error) {
      if (error instanceof BaoError && error.status === 404) return false;
      throw error;
    }
  },

  listPolicies: async () => {
    const res = await bao.list('sys/policies/acl');
    return cleanKeys(res.data?.keys);
  },
  readPolicy: (name: string) => request<AclPolicyResponse>(`sys/policies/acl/${encodeURIComponent(name)}`),
  writePolicy: (name: string, policy: string) =>
    request<void>(`sys/policies/acl/${encodeURIComponent(name)}`, { method: 'POST', data: { policy } }),
  deletePolicy: (name: string) =>
    request<void>(`sys/policies/acl/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  listEntities: async () => {
    const res = await bao.list('identity/entity/name');
    return cleanKeys(res.data?.keys);
  },
  readEntity: async (name: string): Promise<EntitySummary> => {
    const res = await request<{ data?: { name?: string; policies?: string[] } }>(
      `identity/entity/name/${encodeURIComponent(name)}`,
    );
    return { name: res.data?.name ?? name, policies: cleanKeys(res.data?.policies) };
  },
  listAuthMethods: async (): Promise<AuthMethodSummary[]> => {
    const res = await request<{ data?: Record<string, { type?: string; accessor?: string }> }>('sys/auth');
    return Object.entries(res.data ?? {}).map(([path, config]) => ({
      path: path.replace(/\/$/, ''),
      type: config?.type ?? 'unknown',
      accessor: config?.accessor,
    }));
  },

  /**
   * Detect configured auth methods before sign-in. `sys/internal/ui/mounts`
   * is readable without a token, so the login page can show only the methods
   * this server actually has (and explain why the others are unavailable).
   */
  detectAuthMethods: async (): Promise<AuthMethodSummary[]> => {
    const res = await request<{ data?: { auth?: Record<string, { type?: string; accessor?: string }> } }>(
      'sys/internal/ui/mounts',
      { unauthenticated: true },
    );
    return Object.entries(res.data?.auth ?? {}).map(([path, config]) => ({
      path: path.replace(/\/$/, ''),
      type: config?.type ?? 'unknown',
      accessor: config?.accessor,
    }));
  },

  /** Enable the AppRole auth method at its default mount (no-op if already on). */
  enableAppRole: (mount = 'approle') =>
    request<void>(`sys/auth/${encodeURIComponent(mount)}`, { method: 'POST', data: { type: 'approle' } }),

  /** Create an AppRole with the given token policies and lease. */
  createAppRole: (name: string, policies: string[], tokenTtl: string, mount = 'approle') =>
    request<void>(`auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(name)}`, {
      method: 'POST',
      data: { token_policies: policies, token_type: 'service', token_ttl: tokenTtl },
    }),

  /** The role ID is a public identifier (not a credential) and is re-readable. */
  readAppRoleId: (name: string, mount = 'approle') =>
    request<{ data: { role_id: string } }>(
      `auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(name)}/role-id`,
    ),

  /**
   * Generate a NEW secret ID. OpenBao returns it only in this response; it cannot be read back.
   * Callers must hold it only in transient state, never in storage or logs.
   */
  generateAppRoleSecretId: (name: string, mount = 'approle') =>
    request<{ data: { secret_id: string; secret_id_accessor?: string } }>(
      `auth/${encodeURIComponent(mount)}/role/${encodeURIComponent(name)}/secret-id`,
      { method: 'POST', data: {} },
    ),

  /**
   * Checks real capabilities for a set of policies. A short-lived token is minted and revoked in a
   * finally block; the token value never leaves this function or enters UI state/logs.
   */
  simulatePolicies: async (policies: string[], paths: string[]): Promise<CapabilitiesMap> => {
    const created = await request<{ auth?: { client_token?: string } }>('auth/token/create', {
      method: 'POST',
      data: { policies, ttl: '5m', display_name: 'console-access-sim' },
    });
    const token = created.auth?.client_token;
    if (!token) throw new BaoError('OpenBao did not return a simulation token.', 0, 'auth/token/create');
    try {
      const result = await request<{ data?: CapabilitiesMap }>('sys/capabilities', {
        method: 'POST',
        data: { token, paths },
      });
      return result.data ?? {};
    } finally {
      await request<void>('auth/token/revoke', { method: 'POST', data: { token } }).catch(() => undefined);
    }
  },

  /**
   * Audit is a pluggable read-only provider, never a source of secret values.
   * The dev server ships a local-bridge provider; deployments can point
   * VITE_AUDIT_ENDPOINT at their own log reader. Unavailable is a normal result.
   */
  auditTrail: async (path = '', limit = 10): Promise<AuditResponse> => {
    const endpoint = import.meta.env.VITE_AUDIT_ENDPOINT || '/api/audit';
    const query = new URLSearchParams({ path, limit: String(limit) });
    const response = await fetch(`${endpoint}?${query}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Audit log is not available in this deployment.');
    const body = await response.json().catch(() => ({})) as Partial<AuditResponse>;
    return {
      available: body.available !== false,
      entries: Array.isArray(body.entries) ? body.entries : [],
    };
  },
};
