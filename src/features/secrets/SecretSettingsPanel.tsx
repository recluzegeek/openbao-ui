import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { canAny } from '@/lib/capabilities';
import { useSecretMetadata } from '@/lib/queries';
import { durationError, versionSettingsFrom } from '@/lib/secretLifecycle';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/common/Button';
import { ErrorState } from '@/components/common/Extras';

/** Per-secret KV v2 version settings. Changing them never writes a new version. */
export function SecretSettingsPanel({
  project,
  env,
  service,
  caps,
}: {
  project: string;
  env: string;
  service: string;
  caps?: CapabilitiesMap;
}) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const metaQ = useSecretMetadata(project, env, service);
  const physical = secretApiPath(project, env, service);
  const canEdit = canAny(caps, `kv/metadata/${physical}`, ['patch', 'update', 'create']);

  const [maxVersions, setMaxVersions] = useState('0');
  const [deleteAfter, setDeleteAfter] = useState('0s');
  const [casRequired, setCasRequired] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!metaQ.data) return;
    const next = versionSettingsFrom(metaQ.data.data);
    setMaxVersions(String(next.maxVersions));
    setDeleteAfter(next.deleteVersionAfter);
    setCasRequired(next.casRequired);
    setDirty(false);
    setError(null);
  }, [metaQ.data]);

  const durationProblem = durationError(deleteAfter);
  const maxProblem = /^\d+$/.test(maxVersions.trim()) ? null : 'Use 0 (server default) or a whole number.';
  const valid = !durationProblem && !maxProblem;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await bao.patchMetadataSettings(physical, {
        max_versions: Number(maxVersions.trim()),
        delete_version_after: deleteAfter.trim() || '0s',
        cas_required: casRequired,
      });
      await queryClient.invalidateQueries();
      setDirty(false);
      addToast('success', 'Version settings saved', 'Existing versions and annotations were left untouched.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save version settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" data-testid="secret-settings">
      <div className="panel__head">
        <Settings2 size={17} />
        <h3>Version settings</h3>
        <span className="small muted">Stored on this key's KV metadata</span>
      </div>
      <div className="panel__body">
        {metaQ.isLoading && <div className="state"><div className="spinner" /></div>}
        {metaQ.isError && <ErrorState error={metaQ.error} onRetry={() => void metaQ.refetch()} />}
        {metaQ.data && (
          <>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="max-versions">Maximum versions</label>
                <input
                  id="max-versions"
                  type="number"
                  min={0}
                  value={maxVersions}
                  aria-invalid={Boolean(maxProblem)}
                  disabled={!canEdit || saving}
                  onChange={(event) => { setMaxVersions(event.target.value); setDirty(true); }}
                />
                <p className="small muted">0 uses the mount default (normally 10). Older versions are deleted automatically.</p>
                {maxProblem && <p className="small field-error" role="alert">{maxProblem}</p>}
              </div>
              <div className="field">
                <label htmlFor="delete-after">Delete version after</label>
                <input
                  id="delete-after"
                  className="mono"
                  placeholder="0s"
                  value={deleteAfter}
                  aria-invalid={Boolean(durationProblem)}
                  disabled={!canEdit || saving}
                  onChange={(event) => { setDeleteAfter(event.target.value); setDirty(true); }}
                />
                <p className="small muted">A duration such as 30d or 1h30m. 0s keeps versions until you delete them.</p>
                {durationProblem && <p className="small field-error" role="alert">{durationProblem}</p>}
              </div>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={casRequired}
                disabled={!canEdit || saving}
                onChange={(event) => { setCasRequired(event.target.checked); setDirty(true); }}
              />
              Require check-and-set on writes (cas-required)
            </label>
            <p className="small muted">
              With cas-required, every write must send the current version, so two editors cannot silently overwrite each other.
              An inline edit that ignores CAS will fail with a clear conflict instead.
            </p>
            {!canEdit && <div className="notice warning small">Your token cannot change this key's metadata, so settings are read-only.</div>}
            {error && <div className="notice error small" role="alert">{error}</div>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                size="small"
                icon={<Settings2 size={15} />}
                onClick={() => void save()}
                disabled={!canEdit || !dirty || !valid || saving}
                loading={saving}
                data-testid="save-version-settings"
              >
                Save settings
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const current = versionSettingsFrom(metaQ.data!.data);
                  setMaxVersions(String(current.maxVersions));
                  setDeleteAfter(current.deleteVersionAfter);
                  setCasRequired(current.casRequired);
                  setDirty(false);
                  setError(null);
                }}
                disabled={!dirty || saving}
              >
                Reset
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
