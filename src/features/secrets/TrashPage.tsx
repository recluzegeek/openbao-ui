import { useMemo, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Flame, Trash2, Undo2 } from 'lucide-react';
import { bao, type KVDeletedVersion } from '@/lib/api';
import { canAny } from '@/lib/capabilities';
import { formatWhen } from '@/lib/format';
import { lifecycleCapabilityPaths, useProjects, useProjectTrash, useCapabilities } from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Dialog, EmptyState, ErrorState } from '@/components/common/Extras';

/**
 * Trash lists soft-deleted KV versions from metadata only. No version data is
 * read, so this view can never display a secret value.
 */
export function TrashPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, unknown>;
  const [project, setProject] = useState<string | undefined>(typeof search.project === 'string' ? search.project : undefined);
  const [pending, setPending] = useState<{ kind: 'undelete' | 'destroy'; entry: KVDeletedVersion } | null>(null);
  const [busy, setBusy] = useState(false);

  const projectsQ = useProjects();
  const trashQ = useProjectTrash(project);
  const entries = trashQ.data ?? [];
  const paths = useMemo(() => [...new Set(entries.map((entry) => entry.path))], [entries]);
  const capsQ = useCapabilities(paths.slice(0, 100).flatMap((path) => lifecycleCapabilityPaths(path)));
  const caps = capsQ.data;

  function permission(entry: KVDeletedVersion) {
    const [, , , undeletePath, destroyPath] = lifecycleCapabilityPaths(entry.path);
    return {
      undelete: canAny(caps, undeletePath, ['update', 'create']),
      destroy: canAny(caps, destroyPath, ['update', 'create']),
    };
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'undelete') {
        await bao.undeleteVersions(pending.entry.path, [pending.entry.version]);
        addToast('success', `Restored v${pending.entry.version}`, pending.entry.path);
      } else {
        await bao.destroyVersions(pending.entry.path, [pending.entry.version]);
        addToast('success', `Destroyed v${pending.entry.version}`, 'The version cannot be recovered.');
      }
      await queryClient.invalidateQueries();
      setPending(null);
    } catch (error) {
      addToast('error', 'Action failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <div className="page__header">
        <div>
          <p>Soft-deleted versions recoverable from KV metadata. Values are never read or shown here.</p>
        </div>
      </div>

      <div className="control-bar">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="trash-project">Project</label>
          <select
            id="trash-project"
            data-testid="trash-project"
            value={project ?? ''}
            onChange={(event) => setProject(event.target.value || undefined)}
          >
            <option value="">Select a project…</option>
            {projectsQ.data?.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        {project && <Badge size="small">{entries.length} deleted version{entries.length === 1 ? '' : 's'}</Badge>}
      </div>

      {!project && <EmptyState title="Choose a project">Trash scans that project's KV metadata for recoverable versions.</EmptyState>}
      {project && trashQ.isLoading && <div className="state"><div className="spinner" /><p>Scanning KV metadata…</p></div>}
      {project && trashQ.isError && <ErrorState error={trashQ.error} onRetry={() => void trashQ.refetch()} />}
      {project && trashQ.isSuccess && entries.length === 0 && (
        <EmptyState title="Trash is empty">No soft-deleted versions were found in this project.</EmptyState>
      )}
      {entries.length > 0 && (
        <div className="panel" data-testid="trash-table">
          <div className="panel__head">
            <Trash2 size={17} />
            <h3>Deleted versions</h3>
          </div>
          <div className="panel__body">
            {entries.map((entry) => {
              const allowed = permission(entry);
              return (
                <div className="trash-row" key={`${entry.path}:${entry.version}`} data-testid={`trash-${entry.path.replace(/[^\w.-]+/g, '_')}-${entry.version}`}>
                  <div className="trash-row__main">
                    <span className="list-item__title mono">{entry.path} <Badge size="small" variant="warning">v{entry.version}</Badge></span>
                    <span className="list-item__sub">
                      Deleted {formatWhen(entry.deletionTime)} · created {formatWhen(entry.createdTime)}
                    </span>
                  </div>
                  <div className="trash-row__actions">
                    <Link
                      className="btn btn--ghost btn--small"
                      to="/secrets"
                      search={{ project: entry.path.split('/')[0], env: undefined, service: undefined, folder: undefined }}
                    >
                      Browse
                    </Link>
                    <Button
                      size="small"
                      variant="outlined"
                      icon={<Undo2 size={14} />}
                      disabled={!allowed.undelete || busy}
                      onClick={() => setPending({ kind: 'undelete', entry })}
                      data-testid={`trash-restore-${entry.version}`}
                    >
                      Restore
                    </Button>
                    <Button
                      size="small"
                      variant="outlined-danger"
                      icon={<Flame size={14} />}
                      disabled={!allowed.destroy || busy}
                      onClick={() => setPending({ kind: 'destroy', entry })}
                      data-testid={`trash-destroy-${entry.version}`}
                    >
                      Destroy
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="notice small">
              <Archive size={14} /> Restore brings a version back to normal reads. Destroy permanently removes its data.
              Both changes are recorded in the OpenBao audit log.
            </div>
          </div>
        </div>
      )}

      {pending && (
        <Dialog
          title={pending.kind === 'undelete' ? `Restore v${pending.entry.version}?` : `Destroy v${pending.entry.version} permanently?`}
          testId="trash-confirm"
          onClose={() => { if (!busy) setPending(null); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
              <Button
                variant={pending.kind === 'destroy' ? 'danger' : 'primary'}
                icon={pending.kind === 'undelete' ? <Undo2 size={15} /> : <Flame size={15} />}
                onClick={() => void apply()}
                loading={busy}
                disabled={busy}
                data-testid="trash-confirm-action"
              >
                {pending.kind === 'undelete' ? 'Restore version' : 'Destroy permanently'}
              </Button>
            </>
          }
        >
          <p className="small muted mono">{pending.entry.path}</p>
          <p className="small muted">
            {pending.kind === 'undelete'
              ? 'The version becomes readable again. OpenBao may reapply its delete-version-after policy.'
              : 'The version data is permanently removed from storage. This cannot be undone.'}
          </p>
        </Dialog>
      )}
    </div>
  );
}
