import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Info, KeyRound, ShieldCheck } from 'lucide-react';
import { bao, type AuthMethodSummary } from '@/lib/api';
import { can } from '@/lib/capabilities';
import { mask } from '@/lib/format';
import { identitySnippets, validAppRoleName, type CloudProvider, type IdentityKind, type IdentityOptions } from '@/lib/machineIdentity';
import { appRoleCapabilityPaths, useCapabilities } from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet, CopyButton, Dialog } from '@/components/common/Extras';

/** The secret ID is shown at most once. It is never written to state beyond this dialog or to storage. */
function ShowOnceField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="field" data-testid={testId}>
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <code className="mono" style={{ flex: 1, overflowWrap: 'anywhere', padding: '0.5rem', background: 'var(--color-background)', borderRadius: 'var(--radius-md)' }}>
          {revealed ? value : mask(value)}
        </code>
        <button
          type="button" className="icon-btn" aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          onClick={() => setRevealed((open) => !open)}
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <ShieldCheck size={16} /> : <KeyRound size={16} />}
        </button>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

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
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const caps = useCapabilities(appRoleCapabilityPaths()).data;
  const approleEnabled = authMethods.some((method) => method.type === 'approle');
  const canEnableAppRole = can(caps, 'sys/auth/approle', 'create');
  const canCreateRole = can(caps, 'auth/approle/role/__new__', 'create');
  const canCreateAppRole = canCreateRole && (approleEnabled || canEnableAppRole);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Holds the show-once secret ID only until the result dialog is dismissed.
  const [created, setCreated] = useState<{ name: string; roleId: string; secretId: string; accessor?: string } | null>(null);

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

  async function createAppRole() {
    const name = options.name.trim();
    if (!validAppRoleName(name)) return;
    setCreating(true);
    setCreateError(null);
    try {
      if (!approleEnabled) {
        await bao.enableAppRole();
        await queryClient.invalidateQueries({ queryKey: ['auth-methods'] });
      }
      await bao.createAppRole(name, chosenPolicies, options.tokenTtl.trim() || '1h');
      const role = await bao.readAppRoleId(name);
      const secret = await bao.generateAppRoleSecretId(name);
      // The secret ID exists only here until this dialog is closed; it is never
      // logged, put in a URL, or written to storage.
      setCreated({
        name,
        roleId: role.data.role_id,
        secretId: secret.data.secret_id,
        accessor: secret.data.secret_id_accessor,
      });
      setConfirmOpen(false);
      addToast('success', 'AppRole created', `${name} is ready — copy the secret ID now.`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the AppRole.');
    } finally {
      setCreating(false);
    }
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

          {kind === 'approle' && (
            <div className="approle-create">
              <div className="section-title">Create this role on the server</div>
              <p className="small muted">
                Create an AppRole with the policies above. The secret ID is generated once and shown only
                after creation — OpenBao cannot show it again.
              </p>
              <Button
                variant="primary" size="small" data-testid="approle-create"
                disabled={!canCreateAppRole || !validAppRoleName(options.name)}
                onClick={() => { setCreateError(null); setConfirmOpen(true); }}
              >
                {approleEnabled ? 'Create AppRole' : 'Enable AppRole & create'}
              </Button>
              {!validAppRoleName(options.name) && (
                <span className="field-error">Role name: letters, digits, dot, dash or underscore, starting with a letter or digit.</span>
              )}
              {!canCreateAppRole && (
                <p className="small muted">
                  Requires create on <span className="mono">auth/approle/role/</span>
                  {!approleEnabled && <> and on <span className="mono">sys/auth/approle</span> to enable the method</>}.
                </p>
              )}
            </div>
          )}

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

      {confirmOpen && (
        <Dialog
          title="Create AppRole"
          testId="approle-confirm"
          guardClose={() => !creating}
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <Button variant="outlined" disabled={creating} onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                variant="primary" loading={creating} data-testid="approle-confirm-create"
                onClick={() => void createAppRole()}
              >
                {approleEnabled ? 'Create AppRole' : 'Enable AppRole & create'}
              </Button>
            </>
          }
        >
          <div className="grid" style={{ gap: '0.7rem' }}>
            <div className="notice warning small">
              This writes to the live server. A new secret ID will be generated once and shown only in
              the next dialog — it cannot be recovered afterward.
            </div>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
              <dt className="muted">Role name</dt><dd className="mono" style={{ margin: 0 }} data-testid="approle-confirm-name">{options.name.trim()}</dd>
              <dt className="muted">Policies</dt><dd style={{ margin: 0 }}>{chosenPolicies.length ? chosenPolicies.join(', ') : 'none'}</dd>
              <dt className="muted">Token TTL</dt><dd className="mono" style={{ margin: 0 }}>{options.tokenTtl.trim() || '1h'}</dd>
              <dt className="muted">Auth method</dt><dd style={{ margin: 0 }}>{approleEnabled ? 'already enabled' : 'will be enabled at approle/'}</dd>
            </dl>
            {createError && <div className="notice error small" data-testid="approle-create-error">{createError}</div>}
          </div>
        </Dialog>
      )}

      {created && (
        <Dialog
          title="AppRole created — save the secret ID now"
          testId="approle-result"
          onClose={() => setCreated(null)}
          footer={<Button variant="primary" data-testid="approle-result-done" onClick={() => setCreated(null)}>Done</Button>}
        >
          <div className="grid" style={{ gap: '0.8rem' }}>
            <div className="notice warning small">
              This is the only time OpenBao will show this secret ID. Copy it into your secrets manager
              now — closing this dialog clears it from the screen and it is never stored by the console.
            </div>
            <div className="field" data-testid="approle-result-name">
              <label>Role</label>
              <code className="mono">{created.name}</code>
            </div>
            <div className="field">
              <label>Role ID (re-readable, not a credential)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <code className="mono" data-testid="approle-result-role-id" style={{ flex: 1, overflowWrap: 'anywhere', padding: '0.5rem', background: 'var(--color-background)', borderRadius: 'var(--radius-md)' }}>{created.roleId}</code>
                <CopyButton value={created.roleId} label="Copy role ID" />
              </div>
            </div>
            <ShowOnceField label="Secret ID" value={created.secretId} testId="approle-result-secret" />
            {created.accessor && <p className="small muted">Secret ID accessor: <span className="mono">{created.accessor}</span></p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
