/** Generates setup commands for machine identities. Never embeds KV secret values or generated credentials. */
import { shellQuote } from './format';

export type IdentityKind = 'approle' | 'kubernetes' | 'jwt-oidc' | 'cloud';
export type CloudProvider = 'aws' | 'gcp' | 'azure';

/** Role names become a URL path segment, so keep them to a safe, portable set. */
export function validAppRoleName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name.trim());
}

export interface IdentityOptions {
  name: string;
  policies: string[];
  tokenTtl: string;
  namespace: string;
  serviceAccount: string;
  audience: string;
  issuer: string;
  boundClaims: string;
  cloudProvider: CloudProvider;
  roleArn: string;
}

export interface IdentitySnippets {
  mount: string;
  cli: string;
  http: string;
  notes: string[];
}

const DEFAULT_OPTIONS: IdentityOptions = {
  name: 'ci-deploy',
  policies: [],
  tokenTtl: '1h',
  namespace: 'default',
  serviceAccount: 'deploy',
  audience: 'openbao',
  issuer: 'https://issuer.example.com',
  boundClaims: '',
  cloudProvider: 'aws',
  roleArn: '',
};

function policyList(policies: string[]): string {
  return policies.filter(Boolean).join(',') || 'default';
}

function curl(apiPath: string, data: Record<string, unknown>): string {
  return `curl -X POST -H "X-Vault-Token: $BAO_TOKEN" -H "Content-Type: application/json" \\\n  -d ${shellQuote(JSON.stringify(data))} \\\n  "$BAO_ADDR/v1/${apiPath}"`;
}

export function identitySnippets(kind: IdentityKind, overrides: Partial<IdentityOptions> = {}): IdentitySnippets {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const name = options.name.trim() || DEFAULT_OPTIONS.name;
  const policies = policyList(options.policies);
  const ttl = options.tokenTtl.trim() || DEFAULT_OPTIONS.tokenTtl;
  const enable = (mount: string) => `bao auth enable ${mount}`;

  if (kind === 'approle') {
    return {
      mount: 'approle',
      cli: [
        enable('approle'),
        `bao write auth/approle/role/${name} token_policies="${policies}" token_ttl="${ttl}"`,
        `bao read auth/approle/role/${name}/role-id`,
        `bao write -f auth/approle/role/${name}/secret-id`,
      ].join('\n'),
      http: [
        curl('sys/auth/approle', { type: 'approle' }),
        curl(`auth/approle/role/${name}`, { token_policies: policies, token_ttl: ttl }),
        `# The CLI's -f call generates a secret_id; store it in your CI secret store, not here.`,
      ].join('\n'),
      notes: [
        'role-id is not a secret; secret_id is. Generate it in CI and store it in your CI secret store.',
        'The AppRole login returns a token scoped to the policies above.',
      ],
    };
  }

  if (kind === 'kubernetes') {
    return {
      mount: 'kubernetes',
      cli: [
        enable('kubernetes'),
        'bao write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc"',
        `bao write auth/kubernetes/role/${name} bound_service_account_names="${options.serviceAccount}" bound_service_account_namespaces="${options.namespace}" policies="${policies}" ttl="${ttl}"`,
      ].join('\n'),
      http: [
        curl('sys/auth/kubernetes', { type: 'kubernetes' }),
        curl('auth/kubernetes/config', { kubernetes_host: 'https://kubernetes.default.svc' }),
        curl(`auth/kubernetes/role/${name}`, {
          bound_service_account_names: options.serviceAccount,
          bound_service_account_namespaces: options.namespace,
          token_policies: policies,
          ttl,
        }),
      ].join('\n'),
      notes: ['Bind to a dedicated service account in a single namespace.', 'The token_reviewer_jwt is configured out of band so no credential appears here.'],
    };
  }

  if (kind === 'jwt-oidc') {
    const claims = options.boundClaims.trim();
    const bound = claims ? ` bound_claims={${claims.replace(/^\{|\}$/g, '')}}` : '';
    return {
      mount: 'jwt',
      cli: [
        enable('jwt'),
        `bao write auth/jwt/config oidc_discovery_url="${options.issuer}" bound_issuer="${options.issuer}"`,
        `bao write auth/jwt/role/${name} role_type="jwt" bound_audiences="${options.audience}" user_claim="sub"${bound} policies="${policies}" ttl="${ttl}"`,
      ].join('\n'),
      http: [
        curl('sys/auth/jwt', { type: 'jwt' }),
        curl('auth/jwt/config', { oidc_discovery_url: options.issuer, bound_issuer: options.issuer }),
        curl(`auth/jwt/role/${name}`, {
          role_type: 'jwt',
          bound_audiences: options.audience,
          user_claim: 'sub',
          token_policies: policies,
          ttl,
        }),
      ].join('\n'),
      notes: ['Use a narrow audience and at least one bound claim where possible.', 'OIDC discovery must be reachable from the OpenBao server.'],
    };
  }

  const provider = options.cloudProvider;
  const cli = [enable(provider)];
  const http = [curl(`sys/auth/${provider}`, { type: provider })];
  if (provider === 'aws') {
    cli.push(`bao write auth/aws/role/${name} auth_type="iam" role_arn="${options.roleArn}" policies="${policies}" max_ttl="${ttl}"`);
    http.push(curl(`auth/aws/role/${name}`, { auth_type: 'iam', role_arn: options.roleArn, token_policies: policies, max_ttl: ttl }));
  } else if (provider === 'gcp') {
    cli.push(`bao write auth/gcp/role/${name} type="iam" name="${name}" policies="${policies}" max_ttl="${ttl}"`);
    http.push(curl(`auth/gcp/role/${name}`, { type: 'iam', name, token_policies: policies, max_ttl: ttl }));
  } else {
    cli.push(`bao write auth/azure/role/${name} policies="${policies}" max_ttl="${ttl}"`);
    http.push(curl(`auth/azure/role/${name}`, { token_policies: policies, max_ttl: ttl }));
  }
  return {
    mount: provider,
    cli: cli.join('\n'),
    http: http.join('\n'),
    notes: [
      'Configure cloud credentials on the OpenBao server out of band; none are embedded in these commands.',
      'Bind the role to the exact workload identity, not a broad account.',
    ],
  };
}
