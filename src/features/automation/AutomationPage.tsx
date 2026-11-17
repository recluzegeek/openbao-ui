import { useState, type FormEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Bot, Clock, KeyRound, TerminalSquare } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useCapabilities } from '@/lib/queries';
import { can } from '@/lib/capabilities';
import { tokenTtlLabel } from '@/lib/format';
import { baoCliSnippet, curlSnippet, envPullSnippet, githubActionsSnippet } from '@/lib/snippets';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet, EmptyState } from '@/components/common/Extras';

const CAPABILITIES = ['create', 'read', 'update', 'patch', 'delete', 'list', 'sudo'];

export function AutomationPage() {
  const navigate = useNavigate({ from: '/automation' });
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const auth = useAuth();
  const [path, setPath] = useState(search.path ?? 'roomsss/env/development/app');
  const [inspected, setInspected] = useState(path);
  const capsQ = useCapabilities([inspected.replace(/^kv\/data\//, '')]);
  const caps = capsQ.data;
  const apiPath = inspected.replace(/^kv\/data\//, '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setInspected(path);
    void navigate({ to: '/automation', search: { path }, replace: true });
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
                <dt className="muted">Policies</dt>
                <dd style={{ margin: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(auth.identity?.policies ?? []).map((policy) => <Badge key={policy} size="small" variant="outline">{policy}</Badge>)}
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
    </div>
  );
}
