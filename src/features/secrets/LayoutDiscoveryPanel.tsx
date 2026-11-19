import { useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, ChevronDown, Layers, Plus } from 'lucide-react';
import { bao } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { environmentCreationTarget, useCapabilities, type LayoutDiscovery } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Extras';

interface MetadataRow {
  id: number;
  key: string;
  value: string;
}

/** Collapses per-path heuristics into a few human-readable categories. */
function groupWarnings(warnings: string[]) {
  const groups = new Map<string, string[]>();
  for (const warning of warnings) {
    let label = 'A few paths need a closer look';
    if (/disagrees/i.test(warning)) label = 'Server labels overrode path names';
    else if (/environment-like/i.test(warning)) label = 'Some paths had no environment label';
    else if (/secret name/i.test(warning)) label = 'A few paths had no secret name';
    groups.set(label, [...(groups.get(label) ?? []), warning]);
  }
  return [...groups].map(([label, items]) => ({ label, count: items.length, examples: items.slice(0, 2) }));
}

/** Surfaces what the server actually returned and lets privileged users add an environment. */
export function LayoutDiscoveryPanel({ project, discovery, error }: {
  project?: string;
  discovery: LayoutDiscovery | undefined;
  error?: unknown;
}): ReactElement {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<MetadataRow[]>([
    { id: 1, key: 'ui_env', value: '' },
    { id: 2, key: 'ui_description', value: '' },
    { id: 3, key: 'ui_owner', value: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const target = environmentCreationTarget(project, name, discovery);
  const capsQ = useCapabilities(target
    ? [target.dataPath, target.metadataPath, `kv/metadata/${project}/`]
    : []);
  const caps = capsQ.data;
  const allowed = Boolean(target && project && caps
    && can(caps, `kv/metadata/${project}/`, 'create')
    && can(caps, target.dataPath, 'create')
    && (can(caps, target.metadataPath, 'update') || can(caps, target.metadataPath, 'create')));

  const counts = useMemo(() => {
    const result = { metadata: 0, heuristic: 0, raw: 0 };
    for (const secret of discovery?.classified ?? []) result[secret.source] += 1;
    return result;
  }, [discovery]);

  const warningGroups = useMemo(() => groupWarnings(discovery?.warnings ?? []), [discovery]);

  async function createEnvironment(): Promise<void> {
    if (!target) return;
    setBusy(true);
    setCreateError(null);
    try {
      const metadata: Record<string, string> = { ui_env: name.trim() };
      for (const row of rows) {
        const key = row.key.trim();
        if (key) metadata[key] = row.value;
      }
      await bao.createEnvironment(target.physical, metadata);
      await queryClient.invalidateQueries();
      addToast('success', `Environment ${name.trim()} created`, `Metadata written to kv/metadata/${target.physical}`);
      setOpen(false);
      setName('');
      setCreateError(null);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Could not create the environment');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="notice warning small" data-testid="layout-discovery-error">
        Using the built-in path fallback until discovery succeeds.
        {' '}{error instanceof Error ? error.message : 'Server listing failed.'}
      </div>
    );
  }
  if (!discovery) {
    return (
      <div className="panel layout-panel" data-testid="layout-discovery-skeleton" aria-busy="true">
        <div className="panel__head">
          <Layers size={17} />
          <h3>Server layout</h3>
          <span className="skeleton" style={{ width: 110, height: 18, marginLeft: 'auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="panel layout-panel" data-testid="layout-discovery">
      <div className="panel__head">
        <Layers size={17} />
        <h3>Server layout</h3>
        {warningGroups.length > 0 && (
          <button
            type="button"
            className="layout-issues-chip"
            data-testid="layout-issues-chip"
            aria-expanded={expanded && showIssues}
            onClick={() => { setExpanded(true); setShowIssues(true); }}
          >
            <AlertTriangle size={14} />
            {discovery.warnings.length} layout issue{discovery.warnings.length === 1 ? '' : 's'}
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            icon={<Plus size={14} />}
            data-testid="new-environment-open"
            onClick={() => { setOpen(true); setCreateError(null); }}
            disabled={!project}
            title={project ? 'Add an environment and attach metadata' : 'Choose a project first'}
          >
            New environment
          </Button>
          <button
            type="button"
            className="icon-btn"
            data-testid="layout-toggle"
            aria-expanded={expanded}
            title={expanded ? 'Hide layout details' : 'Show layout details'}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown size={16} className={expanded ? 'rotate' : ''} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="panel__body" style={{ display: 'grid', gap: '0.5rem' }}>
          <p className="small muted">{discovery.profile.description}. Discovered {discovery.rawPaths.length} paths on the server.</p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Badge size="small" variant="info">{counts.metadata} labelled by server</Badge>
            <Badge size="small" variant="info">{counts.heuristic} recognised from paths</Badge>
            <Badge size="small" variant="outline">{counts.raw} other</Badge>
          </div>
          {warningGroups.length > 0 && (
            <div className="notice warning small" data-testid="layout-warnings">
              <button
                type="button"
                className="layout-issues-chip"
                aria-expanded={showIssues}
                onClick={() => setShowIssues((value) => !value)}
              >
                <AlertTriangle size={14} />
                {discovery.warnings.length} layout issue{discovery.warnings.length === 1 ? '' : 's'}
                <ChevronDown size={13} className={showIssues ? 'rotate' : ''} />
              </button>
              {showIssues && (
                <div data-testid="layout-issues-detail" style={{ marginTop: '0.4rem' }}>
                  {warningGroups.map((group) => (
                    <p key={group.label} style={{ margin: '0.25rem 0' }}>
                      <strong>{group.label}</strong> ({group.count})
                      <span className="muted mono"> — {group.examples.join('; ')}</span>
                    </p>
                  ))}
                  <span className="muted">Full diagnostics stay in the browser console.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <Dialog
          title={`New environment in ${project}`}
          testId="new-environment-dialog"
          onClose={() => { setOpen(false); setCreateError(null); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button data-testid="new-environment-submit" icon={<Plus size={14} />} onClick={() => void createEnvironment()} loading={busy} disabled={busy || !allowed}>
                Create environment
              </Button>
            </>
          }
        >
          <p className="small muted">
            KV has no folders. This writes a reserved marker secret at the environment path and
            attaches the metadata below to that path. The marker is hidden from the secret list.
          </p>
          <div className="field">
            <label htmlFor="new-env-name">Environment name</label>
            <input
              id="new-env-name"
              className="mono"
              autoFocus
              placeholder="e.g. staging"
              value={name}
              onChange={(event) => { setName(event.target.value); setCreateError(null); }}
            />
          </div>
          {target && <p className="small mono muted">kv/metadata/{target.physical}</p>}
          <div className="divider" />
          <div className="section-title">Metadata</div>
          {rows.map((row) => (
            <div className="field-grid" key={row.id}>
              <div className="field">
                <label htmlFor={`meta-key-${row.id}`}>Key</label>
                <input id={`meta-key-${row.id}`} className="mono" value={row.key}
                  onChange={(event) => setRows((current) => current.map((r) => r.id === row.id ? { ...r, key: event.target.value } : r))} />
              </div>
              <div className="field">
                <label htmlFor={`meta-value-${row.id}`}>Value</label>
                <input id={`meta-value-${row.id}`} value={row.value}
                  onChange={(event) => setRows((current) => current.map((r) => r.id === row.id ? { ...r, value: event.target.value } : r))} />
              </div>
            </div>
          ))}
          <Button size="small" variant="ghost" icon={<Plus size={14} />}
            onClick={() => setRows((current) => [...current, { id: Date.now(), key: '', value: '' }])}>
            Add metadata
          </Button>
          {target && !allowed && caps && (
            <div className="notice warning small" data-testid="new-environment-denied">
              {deniedReason(caps, target.dataPath, 'create')} · {deniedReason(caps, target.metadataPath, 'update')}
            </div>
          )}
          {createError && <div className="notice error small" role="alert">{createError}</div>}
          <div className="notice small">Nothing is written until you click Create environment. The write is recorded in the audit log.</div>
        </Dialog>
      )}
    </div>
  );
}
