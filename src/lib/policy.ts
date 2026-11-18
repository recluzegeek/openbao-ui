/** Visual policy model. Only ACL paths and capability names — no secret values. */

import type { ClassifiedSecret, LayoutProfile } from './layout';

export interface PolicyRule {
  path: string;
  capabilities: string[];
}

export interface AclPolicy {
  name: string;
  policy: string;
}

export type RoleTemplateId = 'viewer' | 'developer' | 'admin';

export const ROLE_TEMPLATES: { id: RoleTemplateId; label: string; blurb: string }[] = [
  { id: 'viewer', label: 'Viewer', blurb: 'Read secrets and versions in one project; never write.' },
  { id: 'developer', label: 'Developer', blurb: 'Read and change app secrets in one project/environment.' },
  { id: 'admin', label: 'Admin', blurb: 'Manage app and shared credentials, plus TOTP administration.' },
];

export const CAPABILITY_ORDER = ['create', 'read', 'update', 'patch', 'delete', 'list', 'sudo', 'deny'];

const ALL_READ = ['list', 'read'];

/**
 * Templates are scoped to a project and, optionally, a single environment (`*` means all).
 * This OpenBao build treats a trailing `*` as a recursive prefix wildcard; `**` and mid-path
 * wildcards are literal. Paths therefore keep the `*` at the very end.
 */
export function templateRules(template: RoleTemplateId, project: string, env = '*'): PolicyRule[] {
  const envList = env === '*' ? '' : `kv/metadata/${project}/env/${env}/`;
  const meta = `kv/metadata/${project}/env/${env === '*' ? '*' : `${env}/*`}`;
  const data = `kv/data/${project}/env/${env === '*' ? '*' : `${env}/*`}`;

  const rules: PolicyRule[] = [
    { path: `kv/metadata/${project}/`, capabilities: ['list'] },
    { path: `kv/metadata/${project}/env/`, capabilities: ['list'] },
    ...(envList ? [{ path: envList, capabilities: ['list'] }] : []),
    { path: meta, capabilities: [...ALL_READ] },
    { path: data, capabilities: ['read'] },
    { path: `kv/metadata/${project}/creds/`, capabilities: ['list'] },
    { path: `kv/data/${project}/creds/*`, capabilities: ['read'] },
  ];

  if (template === 'developer' || template === 'admin') {
    merge(rules, meta, ['create', 'update']);
    merge(rules, data, ['create', 'update', 'delete']);
  }
  if (template === 'admin') {
    merge(rules, `kv/data/${project}/creds/*`, ['create', 'update', 'delete']);
    merge(rules, `kv/metadata/${project}/creds/*`, [...ALL_READ, 'create', 'update', 'delete']);
    rules.push({ path: `totp/code/${project}--*`, capabilities: ['read'] });
    rules.push({ path: `totp/keys/${project}--*`, capabilities: ['create', 'read', 'update', 'delete'] });
  }
  return rules.map((rule) => ({ ...rule, capabilities: orderCapabilities(rule.capabilities) }));
}

/** ACL prefix used to list environments in a discovered layout. */
export function envListMetadataPath(profile: LayoutProfile, project: string): string {
  return profile.kind === 'legacy-env'
    ? `kv/metadata/${project}/env/`
    : `kv/metadata/${project}/`;
}

/** Parent folders of discovered secrets, used to build recursive ACL prefixes. */
export function discoveredParents(project: string, env: string, classified: ClassifiedSecret[]): string[] {
  const selected = classified.filter((secret) => env === '*' || secret.env === env);
  if (selected.length === 0) return [project];
  return [...new Set(selected.map((secret) => {
    const parent = secret.physical.slice(0, secret.physical.lastIndexOf('/'));
    return parent || secret.physical;
  }))];
}

/**
 * Template rules built from the server's real KV tree instead of the hardcoded
 * `<project>/env/<env>` convention. A trailing `*` stays at the very end.
 */
export function templateRulesFromLayout(
  template: RoleTemplateId,
  project: string,
  env: string,
  profile: LayoutProfile,
  classified: ClassifiedSecret[],
): PolicyRule[] {
  const parents = discoveredParents(project, env, classified);
  const meta = parents.map((parent) => `kv/metadata/${parent}/*`);
  const data = parents.map((parent) => `kv/data/${parent}/*`);
  const rules: PolicyRule[] = [
    { path: envListMetadataPath(profile, project), capabilities: ['list'] },
    { path: `kv/metadata/${project}/creds/`, capabilities: ['list'] },
    { path: `kv/data/${project}/creds/*`, capabilities: ['read'] },
    ...meta.map((path) => ({ path, capabilities: [...ALL_READ] })),
    ...data.map((path) => ({ path, capabilities: ['read'] })),
  ];

  if (template === 'developer' || template === 'admin') {
    for (const path of meta) merge(rules, path, ['create', 'update']);
    for (const path of data) merge(rules, path, ['create', 'update', 'delete']);
  }
  if (template === 'admin') {
    merge(rules, `kv/data/${project}/creds/*`, ['create', 'update', 'delete']);
    merge(rules, `kv/metadata/${project}/creds/*`, [...ALL_READ, 'create', 'update', 'delete']);
    rules.push({ path: `totp/code/${project}--*`, capabilities: ['read'] });
    rules.push({ path: `totp/keys/${project}--*`, capabilities: ['create', 'read', 'update', 'delete'] });
  }
  return rules.map((rule) => ({ ...rule, capabilities: orderCapabilities(rule.capabilities) }));
}

/** Simulator presets taken from physical paths the server actually returned. */
export function simulatorPathsFromLayout(
  profile: LayoutProfile,
  project: string,
  env: string,
  classified: ClassifiedSecret[],
): string[] {
  const selected = classified.filter((secret) => env === '*' || secret.env === env).slice(0, 4);
  const paths = [
    ...selected.map((secret) => `kv/data/${secret.physical}`),
    ...selected.slice(0, 2).map((secret) => `kv/metadata/${secret.physical}`),
    envListMetadataPath(profile, project),
    `kv/data/${project}/creds/example-console`,
  ];
  return [...new Set(paths)];
}

/** Policy names that actually mention the project, instead of guessed suffixes. */
export function projectPolicyNames(project: string, policies: string[]): string[] {
  const needle = project.toLowerCase();
  return policies.filter((name) => name.toLowerCase().includes(needle));
}

/** Best-effort mapping from existing policy names to the three role templates. */
export function inferRolePolicyNames(
  project: string,
  env: string,
  policies: string[],
): Partial<Record<RoleTemplateId, string>> {
  const candidates = projectPolicyNames(project, policies);
  const synonyms: Record<RoleTemplateId, string[]> = {
    viewer: ['viewer', 'readonly', 'read-only', 'read'],
    developer: ['developer', 'contributor', 'dev'],
    admin: ['admin', 'owner', 'lead'],
  };
  const result: Partial<Record<RoleTemplateId, string>> = {};
  for (const role of ROLE_TEMPLATES) {
    const tokens = synonyms[role.id];
    result[role.id] = candidates.find((name) => {
      const lower = name.toLowerCase();
      return tokens.some((token) => lower.includes(token))
        && (env === '*' || lower.includes(env.toLowerCase()));
    }) ?? candidates.find((name) => tokens.some((token) => name.toLowerCase().includes(token)));
  }
  return result;
}

function merge(rules: PolicyRule[], path: string, capabilities: string[]): void {
  const found = rules.find((rule) => rule.path === path);
  if (found) found.capabilities = [...new Set([...found.capabilities, ...capabilities])];
  else rules.push({ path, capabilities: [...capabilities] });
}

export function orderCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities)].sort((a, b) => CAPABILITY_ORDER.indexOf(a) - CAPABILITY_ORDER.indexOf(b));
}

export function generateHcl(rules: PolicyRule[]): string {
  const body = rules
    .filter((rule) => rule.path.trim())
    .map((rule) => [
      `path "${rule.path.replace(/"/g, '\\"')}" {`,
      `  capabilities = [${orderCapabilities(rule.capabilities).map((cap) => `"${cap}"`).join(', ')}]`,
      '}',
    ].join('\n'))
    .join('\n\n');
  return `# Managed by OpenBao Console — scoped ACL rules\n${body}\n`;
}

/** Parses the HCL subset this builder emits (path blocks with a capabilities array). */
export function parseHcl(hcl: string): { rules: PolicyRule[]; error?: string } {
  const rules: PolicyRule[] = [];
  const lines = hcl.split(/\r?\n/);
  let current: { path: string; body: string } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (current) {
      if (trimmed === '}') {
        const match = current.body.match(/capabilities\s*=\s*\[([^\]]*)\]/);
        if (!match) return { rules: [], error: `Block for "${current.path}" has no capabilities array.` };
        const capabilities = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
        if (capabilities.length === 0) return { rules: [], error: `Block for "${current.path}" has no capabilities.` };
        rules.push({ path: current.path, capabilities });
        current = null;
      } else {
        current.body += `${line}\n`;
      }
      continue;
    }
    const start = trimmed.match(/^path\s+"([^"]+)"\s*\{\s*$/);
    if (start) {
      current = { path: start[1], body: '' };
      continue;
    }
    return { rules: [], error: `Cannot parse line ${index + 1}: ${trimmed.slice(0, 60)}` };
  }
  if (current) return { rules: [], error: `Unclosed path block for "${current.path}".` };
  return { rules };
}

/**
 * Matches an ACL path rule the way this OpenBao build does: a trailing `*` is a recursive
 * prefix wildcard (including `/`), everything else is literal. Mid-path `*`, `**` and `?`
 * are not wildcards here.
 */
export function globMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

/** Client-side estimate used when the token cannot mint a simulation token. */
export function simulateCapabilities(rules: PolicyRule[], path: string): string[] {
  const matched = rules.filter((rule) => globMatches(rule.path, path));
  if (matched.some((rule) => rule.capabilities.includes('deny'))) return ['deny'];
  return orderCapabilities(matched.flatMap((rule) => rule.capabilities));
}

/** Paths offered as quick checks in the simulator for a project/environment. */
export function simulatorPaths(project: string, env: string): string[] {
  const base = `kv/data/${project}/env/${env}`;
  return [
    `${base}/web`,
    `${base}/database/postgres`,
    `kv/metadata/${project}/env/${env}/`,
    `kv/metadata/${project}/env/${env}/database/postgres`,
    `kv/data/${project}/creds/example-console`,
    `sys/policies/acl/${project}-viewer`,
  ];
}
