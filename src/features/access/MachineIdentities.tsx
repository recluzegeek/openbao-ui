import { useMemo, useState } from 'react';
import { Bot, Info } from 'lucide-react';
import type { AuthMethodSummary } from '@/lib/api';
import { identitySnippets, type CloudProvider, type IdentityKind, type IdentityOptions } from '@/lib/machineIdentity';
import { Badge } from '@/components/common/Badge';
import { CodeSnippet } from '@/components/common/Extras';

interface MachineIdentitiesProps {
  project: string;
  policies: string[];
  authMethods: AuthMethodSummary[];
}

const KINDS: { id: IdentityKind; label: string; blurb: string }[] = [
  { id: 'approle', label: 'AppRole', blurb: 'For CI runners and scripted jobs.' },
  { id: 'kubernetes', label: 'Kubernetes', blurb: 'For pods with a bound service account.' },
  { id: 'jwt-oidc', label: 'JWT / OIDC', blurb: 'For workloads presenting a signed JWT.' },
  { id: 'cloud', label: 'Cloud IAM', blurb: 'For AWS, GCP or Azure workload identities.' },
];

export function MachineIdentities({ project, policies, authMethods }: MachineIdentitiesProps) {
  const [kind, setKind] = useState<IdentityKind>('approle');
  const [options, setOptions] = useState<Omit<IdentityOptions, 'policies'>>({
    name: `${project}-ci`,
    tokenTtl: '1h',
    namespace: 'apps',
    serviceAccount: `${project}-deploy`,
    audience: 'openbao',
    issuer: 'https://issuer.example.com',
    boundClaims: '',
    cloudProvider: 'aws',
    roleArn: '',
  });
  const [chosenPolicies, setChosenPolicies] = useState<string[]>(() =>
    ['viewer', 'developer', 'admin'].map((role) => `${project}-${role}`).filter((name) => policies.includes(name)),
  );

  function set<K extends keyof Omit<IdentityOptions, 'policies'>>(key: K, value: Omit<IdentityOptions, 'policies'>[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  function togglePolicy(name: string) {
    setChosenPolicies((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  const snippets = useMemo(
    () => identitySnippets(kind, { ...options, policies: chosenPolicies }),
    [kind, options, chosenPolicies],
  );

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="panel">
        <div className="panel__head">
          <Bot size={17} />
          <h3>Machine identities</h3>
          <span className="small muted">Generate setup commands for a workload — never credentials or secret values</span>
        </div>
        <div className="panel__body grid" style={{ gap: '1rem' }}>
          <div className="identity-kinds" role="tablist" aria-label="Machine identity type">
            {KINDS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={kind === item.id}
                className={`identity-kind ${kind === item.id ? 'active' : ''}`}
                onClick={() => setKind(item.id)}
                data-testid={`identity-kind-${item.id}`}
              >
                <strong>{item.label}</strong>
                <span className="small muted">{item.blurb}</span>
              </button>
            ))}
          </div>

          <div className="field-grid">
            <div className="field">
              <label htmlFor="identity-name">Role name</label>
              <input id="identity-name" className="mono" value={options.name} onChange={(event) => set('name', event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="identity-ttl">Token TTL</label>
              <input id="identity-ttl" className="mono" value={options.tokenTtl} onChange={(event) => set('tokenTtl', event.target.value)} placeholder="1h" />
            </div>
          </div>

          {(kind === 'kubernetes' || kind === 'jwt-oidc' || kind === 'cloud') && (
            <div className="field-grid">
              {kind === 'kubernetes' && (
                <>
                  <div className="field">
                    <label htmlFor="identity-sa">Service account name</label>
                    <input id="identity-sa" className="mono" value={options.serviceAccount} onChange={(event) => set('serviceAccount', event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="identity-ns">Namespace</label>
                    <input id="identity-ns" className="mono" value={options.namespace} onChange={(event) => set('namespace', event.target.value)} />
                  </div>
                </>
              )}
              {kind === 'jwt-oidc' && (
                <>
                  <div className="field">
                    <label htmlFor="identity-issuer">OIDC discovery URL / issuer</label>
                    <input id="identity-issuer" className="mono" value={options.issuer} onChange={(event) => set('issuer', event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="identity-audience">Bound audience</label>
                    <input id="identity-audience" className="mono" value={options.audience} onChange={(event) => set('audience', event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="identity-claims">Bound claims (HCL, optional)</label>
                    <input id="identity-claims" className="mono" value={options.boundClaims} onChange={(event) => set('boundClaims', event.target.value)} placeholder={'team = "platform"'} />
                  </div>
                </>
              )}
              {kind === 'cloud' && (
                <>
                  <div className="field">
                    <label htmlFor="identity-provider">Cloud provider</label>
                    <select id="identity-provider" value={options.cloudProvider} onChange={(event) => set('cloudProvider', event.target.value as CloudProvider)}>
                      <option value="aws">AWS</option>
                      <option value="gcp">GCP</option>
                      <option value="azure">Azure</option>
                    </select>
                  </div>
                  {options.cloudProvider === 'aws' && (
                    <div className="field">
                      <label htmlFor="identity-arn">Role ARN</label>
                      <input id="identity-arn" className="mono" value={options.roleArn} onChange={(event) => set('roleArn', event.target.value)} placeholder="arn:aws:iam::…:role/ci" />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <div className="section-title">Policies to attach <Badge size="small">{chosenPolicies.length} selected</Badge></div>
            {policies.length === 0 && <p className="small muted">No ACL policies are visible to this token. You can still review the command shape.</p>}
            <div className="policy-checks" data-testid="identity-policies">
              {policies.map((name) => (
                <label key={name} className={`cap-check ${chosenPolicies.includes(name) ? 'on' : ''}`}>
                  <input type="checkbox" checked={chosenPolicies.includes(name)} onChange={() => togglePolicy(name)} aria-label={`Attach policy ${name}`} />
                  {name}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid--split" style={{ gap: '1rem' }}>
            <div>
              <div className="section-title">CLI commands</div>
              <div data-testid="identity-snippet-cli"><CodeSnippet text={snippets.cli} label="Identity CLI" /></div>
            </div>
            <div>
              <div className="section-title">HTTP requests</div>
              <div data-testid="identity-snippet-http"><CodeSnippet text={snippets.http} label="Identity HTTP" /></div>
            </div>
          </div>

          <div className="notice info small">
            <Info size={14} />
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {snippets.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head"><h3>Auth methods enabled</h3><Badge size="small">{authMethods.length}</Badge></div>
        <div className="panel__body">
          {authMethods.length === 0 && <p className="muted">No auth methods are visible. Enable one with the CLI command above.</p>}
          <div className="method-chips">
            {authMethods.map((method) => (
              <span className="method-chip" key={method.path} data-testid={`auth-method-${method.path}`}>
                <code>{method.path}</code> <span className="small muted">{method.type}</span>
              </span>
            ))}
          </div>
          {!authMethods.some((method) => method.path === snippets.mount) && (
            <p className="small muted">The <code>{snippets.mount}</code> method is not enabled yet — the generated commands include the enable step.</p>
          )}
        </div>
      </div>
    </div>
  );
}
