import { useState, type FormEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Bot, Clock, KeyRound, Link2, TerminalSquare } from 'lucide-react';
import { bao } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCapabilities } from '@/lib/queries';
import { can } from '@/lib/capabilities';
import { tokenTtlLabel } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { baoCliSnippet, curlSnippet, envPullSnippet, githubActionsSnippet } from '@/lib/snippets';
import {
  DEFAULT_WRAP_TTL,
  WRAP_TTL_PRESETS,
  shareLinkFor,
  validWrapTtl,
  type SharedSecretPayload,
} from '@/lib/wrapping';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet, CopyButton, Dialog, EmptyState } from '@/components/common/Extras';
import { KvMountBrowser } from './KvMountBrowser';

const CAPABILITIES = ['create', 'read', 'update', 'patch', 'delete', 'list', 'sudo'];

export function AutomationPage() {
  const navigate = useNavigate({ from: '/automation' });
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const auth = useAuth();
  const { addToast } = useToast();
  const [path, setPath] = useState(search.path ?? 'roomsss/env/development/app');
  const [inspected, setInspected] = useState(path);
  const apiPath = inspected.replace(/^kv\/data\//, '');
  // Wrapping needs `update` on sys/wrapping/wrap plus read on the source path.
  const capsQ = useCapabilities([apiPath, 'sys/wrapping/wrap']);
  const caps = capsQ.data;
  const canWrap = can(caps, 'sys/wrapping/wrap', 'update') && can(caps, apiPath, 'read');

  const [wrapTtl, setWrapTtl] = useState<string>(DEFAULT_WRAP_TTL);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setInspected(path);
    setShareLink(null);
    void navigate({ to: '/automation', search: { path }, replace: true });
  }

  async function handleShare() {
    if (!canWrap || !validWrapTtl(wrapTtl)) return;
    setShareBusy(true);
    setShareError(null);
    setShareLink(null);
    try {
      // The secret value is read into memory only to be wrapped; it is never
      // logged, persisted, or embedded in the generated link.
      const secret = await bao.readSecret(apiPath);
      const payload: SharedSecretPayload = {
        source: apiPath,
        wrapped_at: new Date().toISOString(),
        data: secret.data?.data ?? {},
      };
      const wrapped = await bao.wrapResponse(payload, wrapTtl.trim());
      setShareLink(shareLinkFor(wrapped.wrap_info.token));
      addToast('success', 'One-time link created', `Valid for ${wrapTtl.trim()}, single use.`);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not create the link.');
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <div className="page__header">
        <div>
          <h2>For agents and automation</h2>
          <p>Everything a script or coding agent needs: exact API paths, copyable commands and visible permissions.</p>
        </div>
        <Badge variant="primary"><Bot size={13} /> machine-friendly</Badge>
      </div>

      <KvMountBrowser />

      <div className="grid grid--split">
        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <div className="panel__head"><KeyRound size={17} /><h3>Your session</h3></div>
            <div className="panel__body">
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.45rem 0.9rem', fontSize: '0.85rem' }}>
                <dt className="muted">Identity</dt><dd style={{ margin: 0 }}>{auth.identity?.display_name || auth.identity?.name || '—'}</dd>
                <dt className="muted">Entity</dt><dd className="mono small" style={{ margin: 0 }}>{auth.identity?.entity_id || '—'}</dd>
                <dt className="muted">Session</dt><dd style={{ margin: 0 }}><Clock size={13} /> {tokenTtlLabel(auth.identity?.policies, auth.identity?.ttl, auth.identity?.expire_time)}</dd>
                <dt className="muted">Namespace</dt><dd className="mono small" style={{ margin: 0 }}>{auth.namespace || 'root'}</dd>
                <dt className="muted">Effective policies</dt>
                <dd style={{ margin: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(auth.identity?.policies ?? []).map((policy) => <Badge key={policy} size="small" variant="outline">{policy}</Badge>)}
                  {!auth.effectivePolicies && <span className="small muted">Group policies unavailable for this token</span>}
                </dd>
              </dl>
              <div className="notice small" style={{ marginTop: '1rem' }}>
                The token itself is never rendered or logged by this console. It stays in this tab's session storage.
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head"><TerminalSquare size={17} /><h3>Inspect a path</h3></div>
            <div className="panel__body">
              <form onSubmit={handleSubmit} className="grid" style={{ gap: '0.7rem' }}>
                <div className="field">
                  <label htmlFor="api-path">OpenBao API path</label>
                  <input id="api-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="project/env/development/app" className="mono" />
                </div>
                <Button type="submit" size="small">Inspect capabilities</Button>
              </form>
              <div className="divider" />
              <div className="section-title">Capabilities on <span className="mono">{apiPath}</span></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CAPABILITIES.map((cap) => {
                  const allowed = can(caps, apiPath, cap);
                  return <Badge key={cap} size="small" variant={allowed ? 'success' : 'default'}>{allowed ? '✓' : '—'} {cap}</Badge>;
                })}
              </div>
              {capsQ.isLoading && <p className="small muted" style={{ marginTop: '0.7rem' }}>Checking your token…</p>}
            </div>
          </div>
        </div>

        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <div className="panel__head"><h3>Copy a command</h3><span className="muted small">No secret values are embedded</span></div>
            <div className="panel__body grid" style={{ gap: '0.9rem' }}>
              <div>
                <div className="section-title">CLI</div>
                <CodeSnippet text={baoCliSnippet(inspected)} label="CLI command" />
              </div>
              <div>
                <div className="section-title">HTTP</div>
                <CodeSnippet text={curlSnippet(apiPath)} label="curl command" />
              </div>
              <div>
                <div className="section-title">Shell .env (contains values — handle carefully)</div>
                <CodeSnippet text={envPullSnippet(apiPath)} label="env pull command" />
              </div>
              <div>
                <div className="section-title">GitHub Actions (OIDC)</div>
                <CodeSnippet text={githubActionsSnippet(apiPath)} label="GitHub Actions step" />
              </div>
            </div>
          </div>

          <div className="panel" data-testid="share-link-panel">
            <div className="panel__head"><Link2 size={17} /><h3>One-time share link</h3></div>
            <div className="panel__body grid" style={{ gap: '0.8rem' }}>
              <p className="small muted">
                Wrap the current secret's response into a short-lived, single-use link. The recipient
                sees the values once; the wrapping token expires on its own and is never stored here.
              </p>
              <div className="field">
                <label htmlFor="wrap-ttl">Link lifetime</label>
                <input
                  id="wrap-ttl" list="wrap-ttl-presets" className="mono"
                  value={wrapTtl} onChange={(event) => setWrapTtl(event.target.value)}
                  data-testid="wrap-ttl"
                />
                <datalist id="wrap-ttl-presets">
                  {WRAP_TTL_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </datalist>
                {validWrapTtl(wrapTtl)
                  ? <span className="field-hint">Go duration such as 5m, 1h or 24h</span>
                  : <span className="field-error">Use a Go duration like 5m, 1h or 24h</span>}
              </div>
              <div className="notice warning small">
                Anyone with the link can read these values once. Share it over a trusted channel.
              </div>
              <Button
                variant="primary" size="small" data-testid="create-share-link"
                disabled={!canWrap || !validWrapTtl(wrapTtl) || shareBusy}
                loading={shareBusy}
                onClick={() => void handleShare()}
              >
                Create one-time link
              </Button>
              {!canWrap && (
                <p className="small muted">Requires read access to this path and <span className="mono">update</span> on <span className="mono">sys/wrapping/wrap</span>.</p>
              )}
              {shareError && <div className="notice error small" data-testid="share-error">{shareError}</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head"><h3>How this console stays agent-safe</h3></div>
            <div className="panel__body grid" style={{ gap: '0.6rem' }}>
              <p className="small">Every view has a stable URL, including <span className="mono">?project=…&env=…&service=…</span> on Secrets.</p>
              <p className="small">All actions are gated by <span className="mono">sys/capabilities-self</span>, so an agent sees the same limits a human does.</p>
              <p className="small">Secrets are masked by default and never placed in URLs, logs or generated commands.</p>
              <p className="small">Endpoints used here are the same public API paths the CLI uses — nothing is UI-only.</p>
              <EmptyState title="Need another snippet?">Tell us which workflow you want and we will add it here.</EmptyState>
            </div>
          </div>
        </div>
      </div>

      {shareLink && (
        <Dialog
          title="One-time link ready"
          testId="share-link-dialog"
          onClose={() => setShareLink(null)}
          footer={<Button variant="primary" data-testid="share-link-done" onClick={() => setShareLink(null)}>Done</Button>}
        >
          <div className="grid" style={{ gap: '0.8rem' }}>
            <div className="notice warning small">
              This link works once and then expires. It is shown only here — closing this dialog
              removes it from the screen. It is never written to storage.
            </div>
            <div className="field">
              <label>Share link</label>
              <code
                className="mono"
                data-testid="share-link-value"
                style={{ display: 'block', overflowWrap: 'anywhere', padding: '0.6rem', background: 'var(--color-background)', borderRadius: 'var(--radius-md)' }}
              >{shareLink}</code>
            </div>
            <div><CopyButton value={shareLink} label="Copy share link" /></div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
