import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Archive, ExternalLink, Flame, GitCompareArrows, History, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { canAny } from '@/lib/capabilities';
import { formatWhen, mask } from '@/lib/format';
import { lifecycleCapabilityPaths, useAuditTrail, useSecretMetadata } from '@/lib/queries';
import { actorForVersion, diffData, type FieldDiff } from '@/lib/secretDiff';
import { versionState } from '@/lib/secretLifecycle';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Dialog, ErrorState } from '@/components/common/Extras';

interface VersionHistoryPanelProps {
  project: string;
  env: string;
  service: string;
  apiPath: string;
  selectedVersion?: number;
  onSelectVersion: (version?: number) => void;
  canRestore: boolean;
  caps?: CapabilitiesMap;
}

type PendingAction = {
  kind: 'delete' | 'undelete' | 'destroy' | 'purge';
  version?: number;
};

const STATUS_LABELS: Record<FieldDiff['status'], string> = {
  added: 'added',
  removed: 'removed',
  changed: 'changed',
  same: 'same',
};

export function VersionHistoryPanel({
  project, env, service, apiPath, selectedVersion, onSelectVersion, canRestore, caps,
}: VersionHistoryPanelProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const metaQ = useSecretMetadata(project, env, service);
  const audit = useAuditTrail(apiPath);
  const [revealed, setRevealed] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [left, setLeft] = useState<number>();
  const [right, setRight] = useState<number>();
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [dataPath, metaPath, deletePath, undeletePath, destroyPath] =
    lifecycleCapabilityPaths(secretApiPath(project, env, service));
  const canSoftDelete = canAny(caps, dataPath, ['delete']);
  const canDeleteVersion = canAny(caps, deletePath, ['update', 'create']);
  const canUndelete = canAny(caps, undeletePath, ['update', 'create']);
  const canDestroy = canAny(caps, destroyPath, ['update', 'create']);
  const canPurge = canAny(caps, metaPath, ['delete']);

  const versions = useMemo(
    () => Object.keys(metaQ.data?.data.versions ?? {}).map(Number).sort((a, b) => b - a),
    [metaQ.data],
  );
  const current = metaQ.data?.data.current_version;
  const deletedCount = versions.filter((version) => {
    const meta = metaQ.data?.data.versions[String(version)];
    return Boolean(meta?.deletion_time) && !meta?.destroyed;
  }).length;
  const versionKey = versions.join(',');

  useEffect(() => {
    if (!current || left !== undefined || right !== undefined) return;
    setLeft(current);
    setRight(versions.find((version) => version < current) ?? current);
  }, [current, versionKey, left, right, versions]);

  const versionQueries = useQueries({
    queries: [left, right].map((version) => ({
      queryKey: ['secret', project, env, service, 'version', version],
      queryFn: () => bao.readSecret(secretApiPath(project, env, service), version),
      enabled: version !== undefined,
      retry: false,
    })),
  });

  const diff = useMemo(() => {
    const first = versionQueries[0]?.data?.data.data;
    const second = versionQueries[1]?.data?.data.data;
    return first && second ? diffData(first, second) : [];
  }, [versionQueries]);
  const shown = onlyChanges ? diff.filter((item) => item.status !== 'same') : diff;
  const entries = audit.data?.entries ?? [];

  async function restore() {
    if (!restoreVersion || !current) return;
    setRestoring(true);
    try {
      const api = secretApiPath(project, env, service);
      const historical = await bao.readSecret(api, restoreVersion);
      await bao.writeSecret(api, historical.data.data, current);
      await queryClient.invalidateQueries();
      onSelectVersion(undefined);
      setRestoreVersion(null);
      addToast('success', `Restored version ${restoreVersion}`, 'The restore was written as a new version with check-and-set.');
    } catch (error) {
      addToast('error', 'Restore failed', error instanceof Error ? error.message : undefined);
    } finally {
      setRestoring(false);
    }
  }

  async function applyLifecycle() {
    if (!pending) return;
    setBusy(true);
    const api = secretApiPath(project, env, service);
    try {
      if (pending.kind === 'delete') {
        if (pending.version === undefined || pending.version === current) await bao.deleteLatestVersion(api);
        else await bao.softDeleteVersions(api, [pending.version]);
        addToast('success', `Version ${pending.version ?? current} moved to Trash`, 'Recoverable until it is destroyed.');
      } else if (pending.kind === 'undelete') {
        await bao.undeleteVersions(api, [pending.version!]);
        addToast('success', `Restored version ${pending.version}`, 'The version is readable again.');
      } else if (pending.kind === 'destroy') {
        await bao.destroyVersions(api, [pending.version!]);
        addToast('success', `Destroyed version ${pending.version}`, 'This cannot be undone.');
      } else {
        await bao.deleteSecretMetadata(api);
        addToast('success', 'Secret permanently deleted', 'All versions and annotations were removed.');
        onSelectVersion(undefined);
      }
      await queryClient.invalidateQueries();
      setPending(null);
    } catch (error) {
      addToast('error', 'Action failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const pendingTitle = !pending ? '' : {
    delete: `Move version ${pending.version ?? current} to Trash?`,
    undelete: `Restore version ${pending.version}?`,
    destroy: `Destroy version ${pending.version} permanently?`,
    purge: 'Delete this secret permanently?',
  }[pending.kind];
  const pendingCopy = !pending ? '' : {
    delete: 'The version is marked deleted and hidden from reads. Its data stays recoverable from Trash until you destroy it.',
    undelete: 'The version becomes readable again. OpenBao may reapply its delete-version-after policy.',
    destroy: 'The version data is permanently removed from storage. This cannot be undone.',
    purge: 'All versions, key metadata and annotations are removed. Even Trash cannot recover them. This cannot be undone.',
  }[pending.kind];

  return (
    <div className="panel" data-testid="version-history">
      <div className="panel__head">
        <History size={17} />
        <h3>Version history</h3>
        {current && <Badge size="small">v{current}</Badge>}
        {deletedCount > 0 && (
          <button
            className="link-btn small"
            data-testid="open-trash"
            onClick={() => void navigate({ to: '/trash', search: { project } })}
            title="Open the Trash view for this project"
          >
            {deletedCount} in Trash <ExternalLink size={12} />
          </button>
        )}
        {canPurge && (
          <button
            className="icon-btn"
            aria-label="Delete secret and all versions permanently"
            title="Delete secret and all versions permanently"
            data-testid="purge-secret"
            onClick={() => setPending({ kind: 'purge' })}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="panel__body">
        {metaQ.isLoading && <div className="state"><div className="spinner" /></div>}
        {metaQ.isError && <ErrorState error={metaQ.error} onRetry={() => void metaQ.refetch()} />}
        {versions.length === 0 && metaQ.isSuccess && <p className="muted">No versions are available for this secret.</p>}
        {versions.map((version) => {
          const meta = metaQ.data!.data.versions[String(version)];
          const actor = actorForVersion(entries, meta.created_time);
          const state = versionState(version, meta, current);
          return (
            <div className={`version-row ${selectedVersion === version || (selectedVersion === undefined && version === current) ? 'selected' : ''}`} key={version} data-testid={`version-${version}`}>
              <button
                className="version-row__main"
                onClick={() => onSelectVersion(version === current ? undefined : version)}
                title="View this point in time"
              >
                <span className="list-item__title">
                  Version {version}
                  {state === 'deleted' && <Badge size="small" variant="warning">in trash</Badge>}
                  {state === 'destroyed' && <Badge size="small" variant="danger">destroyed</Badge>}
                </span>
                <span className="list-item__sub">
                  {formatWhen(meta.created_time)}
                  {actor ? ` · by ${actor}` : ''}
                  {state === 'deleted' && meta.deletion_time ? ` · deleted ${formatWhen(meta.deletion_time)}` : ''}
                </span>
              </button>
              <span className="version-row__actions">
                <button className={`mini-btn ${left === version ? 'active' : ''}`} onClick={() => setLeft(version)} title="Use as left side of diff">A</button>
                <button className={`mini-btn ${right === version ? 'active' : ''}`} onClick={() => setRight(version)} title="Use as right side of diff">B</button>
                {state === 'deleted' && canUndelete && (
                  <button className="mini-btn" onClick={() => setPending({ kind: 'undelete', version })} title={`Restore version ${version}`} aria-label={`Undelete version ${version}`} data-testid={`undelete-${version}`}>
                    <Undo2 size={13} />
                  </button>
                )}
                {state === 'deleted' && canDestroy && (
                  <button className="mini-btn mini-btn--danger" onClick={() => setPending({ kind: 'destroy', version })} title={`Destroy version ${version} permanently`} aria-label={`Destroy version ${version}`} data-testid={`destroy-${version}`}>
                    <Flame size={13} />
                  </button>
                )}
                {(state === 'older' && canDeleteVersion || state === 'current' && canSoftDelete) && (
                  <button className="mini-btn" onClick={() => setPending({ kind: 'delete', version })} title={`Move version ${version} to Trash`} aria-label={`Delete version ${version}`} data-testid={`delete-version-${version}`}>
                    <Archive size={13} />
                  </button>
                )}
                {version !== current && canRestore && (
                  <button className="mini-btn" onClick={() => setRestoreVersion(version)} title={`Restore version ${version}`} aria-label={`Restore version ${version}`}>
                    <RotateCcw size={13} />
                  </button>
                )}
                {version === current && <Badge variant="success" size="small">current</Badge>}
              </span>
            </div>
          );
        })}

        <div className="divider" />
        <div className="diff-head">
          <GitCompareArrows size={16} />
          <h4>Diff v{left ?? '–'} → v{right ?? '–'}</h4>
          <label className="check-row">
            <input type="checkbox" checked={onlyChanges} onChange={(event) => setOnlyChanges(event.target.checked)} />
            Only changes
          </label>
          <Button size="small" variant="ghost" onClick={() => setRevealed((value) => !value)}>
            {revealed ? 'Mask values' : 'Reveal values'}
          </Button>
        </div>
        {versionQueries.some((query) => query.isLoading) && <div className="state"><div className="spinner" /></div>}
        {diff.length === 0 && !versionQueries.some((query) => query.isLoading) && (
          <p className="small muted">Choose two readable versions to see what changed.</p>
        )}
        {shown.length > 0 && (
          <div className="diff-table" data-testid="version-diff">
            <div className="diff-table__head"><span>Field</span><span>v{left}</span><span>v{right}</span></div>
            {shown.map((item) => (
              <div className={`diff-table__row diff-table__row--${item.status}`} key={item.key} data-testid={`diff-${item.key}`}>
                <span className="mono">{item.key} <Badge size="small" variant={item.status === 'same' ? 'outline' : 'info'}>{STATUS_LABELS[item.status]}</Badge></span>
                <span className={`mono ${revealed ? '' : 'masked'}`}>{item.left === undefined ? '—' : revealed ? item.left : mask(item.left)}</span>
                <span className={`mono ${revealed ? '' : 'masked'}`}>{item.right === undefined ? '—' : revealed ? item.right : mask(item.right)}</span>
              </div>
            ))}
          </div>
        )}
        {entries.length === 0 && <p className="small muted">Actor names come from the local audit log and may be unavailable.</p>}
      </div>

      {restoreVersion !== null && (
        <Dialog
          title={`Restore version ${restoreVersion}?`}
          onClose={() => setRestoreVersion(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setRestoreVersion(null)} disabled={restoring}>Cancel</Button>
              <Button icon={<RotateCcw size={15} />} onClick={() => void restore()} loading={restoring} disabled={restoring}>Restore</Button>
            </>
          }
        >
          <p className="small muted">
            This reads version {restoreVersion} and writes it as a new version using check-and-set
            against the current version {current}. Nothing is deleted, and the write is recorded in
            the audit log.
          </p>
          <div className="notice warning small">Anyone with read access to this path can see the restored values.</div>
        </Dialog>
      )}

      {pending && (
        <Dialog
          title={pendingTitle}
          testId="lifecycle-confirm"
          onClose={() => { if (!busy) setPending(null); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
              <Button
                variant={pending.kind === 'destroy' || pending.kind === 'purge' ? 'danger' : 'primary'}
                icon={pending.kind === 'undelete' ? <Undo2 size={15} /> : pending.kind === 'delete' ? <Archive size={15} /> : <Trash2 size={15} />}
                onClick={() => void applyLifecycle()}
                loading={busy}
                disabled={busy}
                data-testid="confirm-lifecycle"
              >
                {pending.kind === 'undelete' ? 'Restore'
                  : pending.kind === 'delete' ? 'Move to Trash'
                    : pending.kind === 'destroy' ? 'Destroy permanently' : 'Delete secret'}
              </Button>
            </>
          }
        >
          <p className="small muted">{pendingCopy}</p>
          <div className="notice warning small">
            {pending.kind === 'delete' ? 'Soft deletes are reversible from the Trash view.'
              : 'Your token and this change are recorded in the OpenBao audit log.'}
          </div>
        </Dialog>
      )}
    </div>
  );
}
