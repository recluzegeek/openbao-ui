import type { AuditResponse } from './audit';

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

export function isAuthenticated(): boolean {
  return Boolean(getBaoConfig().token);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
  list?: boolean;
  params?: Record<string, string>;
  /** Allow the call without a token (health/seal status/login). */
  unauthenticated?: boolean;
  /** Override the token for one request, e.g. while testing a login. */
  token?: string;
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
  if (options.data !== undefined) headers['Content-Type'] = 'application/json';

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
    versions: Record<string, { created_time: string; deletion_time?: string; destroyed?: boolean }>;
    custom_metadata?: Record<string, string>;
  };
}

export interface ListResponse {
  data: { keys: string[] } | null;
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
  capabilities: (paths: string[]) =>
    request<{ data: CapabilitiesMap }>('sys/capabilities-self', { method: 'POST', data: { paths } }),
  loginUserpass: (username: string, password: string, mount = 'userpass') =>
    request<{ auth: { client_token: string } }>(`auth/${mount}/login/${encodeURIComponent(username)}`, {
      method: 'POST',
      data: { password },
      unauthenticated: true,
    }),
  logout: () => request<void>('auth/token/revoke-self', { method: 'POST' }),

  list: (path: string) => request<ListResponse>(path, { list: true }),

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
  readRunbook: (project: string) => bao.readSecret(`_runbooks/${encodeURIComponent(project)}`),
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

  /** Dev-only local audit view; this endpoint is served by the Vite middleware, not OpenBao. */
  auditTrail: async (path: string): Promise<AuditResponse> => {
    const response = await fetch(`/api/audit?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({})) as Partial<AuditResponse> & { error?: string };
    if (!response.ok) throw new Error(body.error || `Audit request failed (${response.status})`);
    return { available: true, entries: Array.isArray(body.entries) ? body.entries : [] };
  },
};
