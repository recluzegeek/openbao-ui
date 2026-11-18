import { useState } from 'react';
import { Database, Folder, KeyRound, RefreshCw } from 'lucide-react';
import { bao } from '@/lib/api';
import { can } from '@/lib/capabilities';
import { mask } from '@/lib/format';
import { kvBrowserCapabilityPaths, useCapabilities, useKvMounts } from '@/lib/queries';
import {
  kvDataPath,
  kvListPath,
  kvMountLabel,
  type KvMountInfo,
} from '@/lib/kvMounts';
import { baoCliSnippet, curlSnippet } from '@/lib/snippets';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet, EmptyState } from '@/components/common/Extras';

function join(folder: string, key: string): string {
  const clean = key.replace(/^\/+|\/+$/g, '');
  return [folder.replace(/\/+$/, ''), clean].filter(Boolean).join('/');
}

/** A KV v1/v2-aware path browser: no project/env layout assumptions. */
export function KvMountBrowser() {
  const mountsQ = useKvMounts();
  const mounts = mountsQ.data ?? [];
  const [mountPath, setMountPath] = useState('');
  const mount: KvMountInfo | undefined = mounts.find((item) => item.path === mountPath) ?? mounts[0];

  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const caps = useCapabilities(kvBrowserCapabilityPaths(mount, folder)).data;
  const listPath = mount ? kvListPath(mount, folder) : '';
  const canList = Boolean(mount && can(caps, listPath, 'list'));
  const canRead = Boolean(mount && can(caps, kvDataPath(mount, '__new__'), 'read'));

  function selectMount(value: string) {
    setMountPath(value);
    setFolder('');
    setEntries(null);
    setSelected(null);
    setFields([]);
    setError(null);
  }

  async function browse(nextFolder: string) {
    if (!mount || !canList) return;
    setBusy(true);
    setError(null);
    setSelected(null);
    setFields([]);
    try {
      const res = await bao.list(kvListPath(mount, nextFolder));
      setEntries((res.data?.keys ?? []).map((key) => String(key)));
      setFolder(nextFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list this folder.');
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }

  async function openSecret(logical: string) {
    if (!mount || !canRead) return;
    setBusy(true);
    setError(null);
    try {
      // Only field names are kept. The response's values are never rendered,
      // logged or written to state/storage.
      const res = await bao.readKvPath(kvDataPath(mount, logical));
      const body = res.data;
      const fieldMap = (mount.version === 2 ? body?.data : body) as Record<string, unknown> | undefined;
      setFields(fieldMap && typeof fieldMap === 'object' ? Object.keys(fieldMap) : []);
      setSelected(logical);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this secret.');
      setFields([]);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  const crumbs = folder.split('/').filter(Boolean);

  return (
    <div className="panel" data-testid="kv-mount-browser">
      <div className="panel__head">
        <Database size={17} />
        <h3>KV mount browser</h3>
        <span className="small muted">Works on any KV v1 or v2 mount — no layout assumptions</span>
      </div>
      <div className="panel__body grid" style={{ gap: '0.9rem' }}>
        {mountsQ.isError && <div className="notice error small">Could not discover mounts: {mountsQ.error instanceof Error ? mountsQ.error.message : 'unknown error'}</div>}
        {mounts.length === 0 && !mountsQ.isLoading && (
          <EmptyState title="No KV mounts found">Enable a KV engine on the server, then refresh.</EmptyState>
        )}

        {mount && (
          <>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="kv-mount-picker">Mount</label>
                <select
                  id="kv-mount-picker" data-testid="kv-mount-picker"
                  value={mount.path} onChange={(event) => selectMount(event.target.value)}
                >
                  {mounts.map((item) => <option key={item.path} value={item.path}>{kvMountLabel(item)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Version</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: 36 }} data-testid="kv-mount-version">
                  <Badge variant={mount.version === 2 ? 'primary' : 'outline'}>KV v{mount.version}</Badge>
                  <span className="small muted">{mount.version === 2 ? 'data + metadata endpoints' : 'single data namespace'}</span>
                </div>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label>Listing path</label>
                <code className="mono small" data-testid="kv-list-path" style={{ overflowWrap: 'anywhere' }}>{listPath}</code>
              </div>
              <div className="field">
                <label>Current folder</label>
                <div className="kv-crumbs" data-testid="kv-browser-path" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 36 }}>
                  <button type="button" className="link-btn" onClick={() => void browse('')} data-testid="kv-crumb-root">root</button>
                  {crumbs.map((crumb, index) => (
                    <span key={`${crumb}-${index}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <span className="muted">/</span>
                      <button type="button" className="link-btn" onClick={() => void browse(crumbs.slice(0, index + 1).join('/'))}>{crumb}</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {!canList && <div className="notice warning small">Your token cannot list <span className="mono">{listPath}</span>. Listing requires <span className="mono">list</span> on that path.</div>}
            {error && <div className="notice error small" data-testid="kv-browser-error">{error}</div>}

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Button size="small" data-testid="kv-browser-browse" disabled={!canList || busy} loading={busy} onClick={() => void browse(folder)}>
                <RefreshCw size={14} /> Browse this folder
              </Button>
              <Button size="small" variant="ghost" data-testid="kv-mounts-refresh" onClick={() => void mountsQ.refetch()}>Refresh mounts</Button>
            </div>

            {entries !== null && (
              <div className="panel" style={{ background: 'var(--color-background)' }}>
                <div className="panel__body grid" style={{ gap: '0.25rem', padding: '0.5rem' }} data-testid="kv-browser-entries">
                  {entries.length === 0 && <p className="small muted">No keys in this folder.</p>}
                  {entries.map((key) => {
                    const isFolder = key.endsWith('/');
                    const clean = key.replace(/\/+$/, '');
                    const logical = join(folder, clean);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`list-item ${selected === logical ? 'selected' : ''}`}
                        data-testid={`kv-browser-entry-${clean}`}
                        disabled={busy || (isFolder ? !canList : !canRead)}
                        onClick={() => void (isFolder ? browse(logical) : openSecret(logical))}
                        style={{ textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}
                      >
                        {isFolder ? <Folder size={14} /> : <KeyRound size={14} />}
                        <span className="mono">{clean}</span>
                        <span className="small muted">{isFolder ? 'folder' : 'secret'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selected && (
              <div className="grid" style={{ gap: '0.6rem' }}>
                <div className="section-title">
                  Field names in <span className="mono">{selected}</span>
                  <Badge size="small">{fields.length}</Badge>
                </div>
                <p className="small muted">Values stay masked. Use a snippet below to read them with your own credentials.</p>
                <div className="panel" style={{ background: 'var(--color-background)' }}>
                  <div className="panel__body grid" style={{ gap: '0.3rem', padding: '0.5rem' }} data-testid="kv-browser-fields">
                    {fields.length === 0 && <p className="small muted">This secret has no readable fields.</p>}
                    {fields.map((name) => (
                      <div key={name} className="secret-field" data-testid={`kv-browser-field-${name}`}>
                        <span className="secret-field__key">{name}</span>
                        <span className="secret-field__value masked">{mask('value')}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid--split" style={{ gap: '1rem' }}>
                  <div>
                    <div className="section-title">CLI</div>
                    <div data-testid="kv-browser-snippet-cli"><CodeSnippet text={baoCliSnippet(selected, mount)} label="Mount CLI" /></div>
                  </div>
                  <div>
                    <div className="section-title">HTTP</div>
                    <div data-testid="kv-browser-snippet-http"><CodeSnippet text={curlSnippet(selected, mount)} label="Mount curl" /></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
