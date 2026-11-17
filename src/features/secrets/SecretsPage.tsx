import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BookOpen,
  Database,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  History,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Search,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { envRank, secretApiPath, secretPath } from '@/lib/baoPaths';
import { envFile, formatWhen, mask } from '@/lib/format';
import { dataFromRows, rowsFromData, validateRows, validSecretName, type FieldRow } from '@/lib/secretForm';
import {
  capabilityPathsForSecret,
  useCapabilities,
  useCredentials,
  useEnvironments,
  useProjects,
  useSecret,
  useSecretMetadata,
  useServices,
} from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { useClipboard } from '@/lib/useClipboard';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CopyButton, Dialog, EmptyState, EnvBadge, ErrorState } from '@/components/common/Extras';
import { RecentActivityPanel } from './RecentActivityPanel';

type Search = Record<string, string | undefined>;

function SecretField({ name, value }: { name: string; value: unknown }) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed ? String(value ?? '') : mask(value);

  return (
    <div className="secret-field" data-testid={`field-${name}`}>
      <span className="secret-field__key" title={name}>{name}</span>
      <span className={`secret-field__value ${revealed ? '' : 'masked'}`}>{display}</span>
      <span className="secret-field__actions">
        <button
          className="icon-btn"
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? `Hide ${name}` : `Reveal ${name}`}
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <CopyButton value={value === null || value === undefined ? '' : String(value)} label={`Copy ${name}`} />
      </span>
    </div>
  );
}

function TargetPreview({ project, env, service }: { project: string; env: string; service: string }) {
  const query = useQuery({
    queryKey: ['secret', project, env, service, 'latest'],
    queryFn: () => bao.readSecret(secretApiPath(project, env, service)),
    retry: false,
  });
  if (query.isLoading) return <div className="state"><div className="spinner" /></div>;
  if (query.isError) {
    return <div className="notice">No readable value at the target. Promotion will create or overwrite it.</div>;
  }
  const data = query.data?.data.data ?? {};
  if (Object.keys(data).length === 0) return <div className="notice">Target is empty.</div>;
  return (
    <div className="grid">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="secret-field">
          <span className="secret-field__key">{key}</span>
          <span className="secret-field__value masked">{mask(value)}</span>
          <span />
        </div>
      ))}
      <p className="small muted">Values stay masked here. The destination is overwritten with the selected version.</p>
    </div>
  );
}

function CredentialsPanel({ project, caps }: { project: string; caps: CapabilitiesMap | undefined }) {
  const creds = useCredentials(project);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['cred', project, selected],
    queryFn: () => bao.readSecret(`${project}/creds/${selected!}`),
    enabled: Boolean(project && selected),
  });
  const path = selected ? `kv/data/${project}/creds/${selected}` : '';
  const allowed = can(caps, path, 'read');

  return (
    <div className="grid grid--split">
      <div className="panel">
        <div className="panel__head"><h3>Shared credentials</h3></div>
        {creds.isLoading && <div className="state"><div className="spinner" /></div>}
        {creds.data?.length === 0 && <EmptyState icon={<KeyRound size={26} />} title="No shared credentials">Add secrets under <code>{project}/creds/</code> to see them here.</EmptyState>}
        {creds.data?.map((name) => (
          <button key={name} className={`list-item ${selected === name ? 'selected' : ''}`} onClick={() => setSelected(name)}>
            <KeyRound size={16} />
            <span className="list-item__main"><span className="list-item__title">{name}</span></span>
          </button>
        ))}
      </div>
      <div className="panel">
        <div className="panel__head"><h3>{selected ?? 'Select a credential'}</h3></div>
        <div className="panel__body">
          {!selected && <p className="muted">Choose a credential on the left. Values are masked until you reveal them.</p>}
          {selected && !allowed && <div className="notice warning">{deniedReason(caps, path, 'read')}</div>}
          {detail.isLoading && <div className="state"><div className="spinner" /></div>}
          {detail.isError && <ErrorState error={detail.error} />}
          {detail.data && Object.entries(detail.data.data.data).map(([key, value]) => (
            <SecretField key={key} name={key} value={value} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SecretsPage() {
  const navigate = useNavigate({ from: '/secrets' });
  const search = useRouterState({ select: (state) => state.location.search }) as Search;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const copy = useClipboard();

  const projects = useProjects();
  const [project, setProject] = useState<string | undefined>(search.project);
  const environments = useEnvironments(project);
  const envs = useMemo(() => [...(environments.data ?? [])].sort(envRank), [environments.data]);
  const [env, setEnv] = useState<string | undefined>(search.env);
  const services = useServices(project, env);
  const [service, setService] = useState<string | undefined>(search.service);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'env' | 'creds'>('env');
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [promoteTo, setPromoteTo] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    mode: 'create' | 'edit';
    name: string;
    rows: FieldRow[];
    cas: number;
  } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealValues, setRevealValues] = useState(false);

  useEffect(() => {
    if (!project && projects.data?.length) setProject(search.project ?? projects.data[0]);
  }, [projects.data, project, search.project]);

  useEffect(() => {
    if (!env && envs.length) setEnv(search.env && envs.includes(search.env) ? search.env : envs[0]);
  }, [envs, env, search.env]);

  useEffect(() => {
    if (!service && services.data?.length) setService(search.service ?? services.data[0]);
  }, [services.data, service, search.service]);

  useEffect(() => {
    if (project && env && service) {
      void navigate({
        to: '/secrets',
        search: { project, env, service },
        replace: true,
      });
    }
  }, [project, env, service, navigate]);

  const capsQ = useCapabilities(capabilityPathsForSecret(project, env, service, envs));
  const caps = capsQ.data;
  const secretQ = useSecret(project, env, service, version);
  const metadataQ = useSecretMetadata(project, env, service);

  const currentPath = project && env && service ? secretPath(project, env, service) : '';
  const apiPath = project && env && service ? secretApiPath(project, env, service) : '';
  const newPath = project && env ? `kv/data/${project}/env/${env}/__new__` : '';
  const writable = can(caps, currentPath, 'update') || can(caps, currentPath, 'create');
  const canCreate = can(caps, newPath, 'create') || can(caps, newPath, 'update');
  const filteredServices = (services.data ?? []).filter((name) => name.toLowerCase().includes(filter.toLowerCase()));

  function updateRow(id: string, patch: Partial<FieldRow>) {
    setEditor((current) => current && {
      ...current,
      rows: current.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  function addRow() {
    setEditor((current) => current && {
      ...current,
      rows: [...current.rows, { id: `new-${Date.now()}-${current.rows.length}`, key: '', value: '' }],
    });
  }

  async function openCreate() {
    setEditorError(null);
    setEditor({ mode: 'create', name: '', rows: [{ id: 'new-0', key: '', value: '' }], cas: 0 });
  }

  async function openEdit() {
    if (!project || !env || !service) return;
    setEditorError(null);
    try {
      // Always edit the latest version, even if an older version is being viewed.
      const latest = await bao.readSecret(secretApiPath(project, env, service));
      setEditor({
        mode: 'edit',
        name: service,
        rows: rowsFromData(latest.data.data),
        cas: latest.data.metadata.version,
      });
    } catch (error) {
      addToast('error', 'Could not load the secret', error instanceof Error ? error.message : undefined);
    }
  }

  async function saveEditor() {
    if (!project || !env || !editor) return;
    const name = editor.name.trim();
    if (!validSecretName(name)) {
      setEditorError('Give the secret a name (a single path segment, without "/").');
      return;
    }
    const invalid = validateRows(editor.rows);
    if (invalid) {
      setEditorError(invalid);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      // bao.writeSecret() adds the kv/data/ prefix, so pass the bare API path.
      await bao.writeSecret(`${project}/env/${env}/${name}`, dataFromRows(editor.rows), editor.cas);
      await queryClient.invalidateQueries();
      addToast(
        'success',
        editor.mode === 'create' ? 'Secret created' : 'Secret saved',
        `kv/data/${project}/env/${env}/${name} · version ${editor.cas + 1}`,
      );
      setService(name);
      setVersion(undefined);
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function promote() {
    if (!project || !env || !service || !promoteTo || !secretQ.data) return;
    const target = secretApiPath(project, promoteTo, service);
    const data = secretQ.data.data.data;
    try {
      await bao.writeSecret(target, data);
      await queryClient.invalidateQueries();
      addToast('success', `Promoted to ${promoteTo}`, `${project}/${service} now matches ${env}.`);
      setPromoteTo(null);
    } catch (error) {
      addToast('error', 'Promotion failed', error instanceof Error ? error.message : undefined);
    }
  }

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <div className="page__header">
        <div>
          <h2>Environment-aware secrets</h2>
          <p>Pick a project and environment. Values are masked until you ask to see them.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="outlined" size="small" icon={<BookOpen size={15} />} onClick={() => void navigate({ to: '/runbooks', search: { project: project ?? undefined } })}>
            Runbook
          </Button>
          <Button variant="outlined" size="small" icon={<FileJson size={15} />} onClick={() => setTab('creds')}>
            Shared credentials
          </Button>
          <Button variant="outlined" size="small" icon={<TerminalSquare size={15} />} onClick={() => void navigate({ to: '/automation', search: { path: apiPath || undefined } })}>
            For agents
          </Button>
        </div>
      </div>

      <div className="control-bar">
        <div className="field">
          <label htmlFor="project">Project</label>
          <select id="project" value={project ?? ''} onChange={(event) => { setProject(event.target.value); setService(undefined); setVersion(undefined); }}>
            {projects.isLoading && <option>Loading…</option>}
            {projects.data?.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Environment</label>
          <div className="env-switch" role="group" aria-label="Environment">
            {envs.map((name) => {
              const allowed = can(caps, `kv/metadata/${project}/env/${name}/`, 'list');
              return (
                <button
                  key={name}
                  aria-pressed={env === name}
                  onClick={() => { setEnv(name); setService(undefined); setVersion(undefined); }}
                  title={allowed ? `Browse ${name}` : 'Your token cannot list this environment'}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Filter services" placeholder="Filter secrets…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Secret views" style={{ marginBottom: '-0.4rem' }}>
        <button className={`btn btn--${tab === 'env' ? 'primary' : 'outlined'} btn--small`} role="tab" aria-selected={tab === 'env'} onClick={() => setTab('env')}>Environment secrets</button>
        <button className={`btn btn--${tab === 'creds' ? 'primary' : 'outlined'} btn--small`} role="tab" aria-selected={tab === 'creds'} onClick={() => setTab('creds')}>Shared credentials</button>
      </div>

      {tab === 'creds' ? (
        project ? <CredentialsPanel project={project} caps={caps} /> : <EmptyState title="Choose a project" />
      ) : (
        <div className="grid grid--split">
          <div className="panel">
            <div className="panel__head">
              <FolderOpen size={17} />
              <h3>{service ? `${project}/env/${env}` : 'Services'}</h3>
              <Badge size="small">{filteredServices.length}</Badge>
              <Button
                size="small"
                variant="outlined"
                icon={<Plus size={14} />}
                onClick={() => void openCreate()}
                disabled={!canCreate}
                title={canCreate ? 'Create a secret in this environment' : 'Your token cannot create secrets here'}
              >
                New secret
              </Button>
            </div>
            {services.isLoading && <div className="state"><div className="spinner" /></div>}
            {services.isError && <ErrorState error={services.error} />}
            {!services.isLoading && filteredServices.length === 0 && (
              <EmptyState icon={<FolderOpen size={26} />} title="Nothing here yet">No secrets under this environment, or your token cannot list them.</EmptyState>
            )}
            {filteredServices.map((name) => (
              <button key={name} className={`list-item ${service === name ? 'selected' : ''}`} onClick={() => { setService(name); setVersion(undefined); }}>
                <Database size={16} />
                <span className="list-item__main">
                  <span className="list-item__title">{name}</span>
                  <span className="list-item__sub">kv/data/{project}/env/{env}/{name}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid" style={{ gap: '1rem' }}>
            <div className="panel">
              <div className="panel__head">
                <KeyRound size={17} />
                <h3>{service ?? 'Select a secret'}</h3>
                {env && <EnvBadge env={env} />}
                {version !== undefined && <Badge variant="info" size="small">v{version}</Badge>}
                {!writable && currentPath && <Badge variant="outline" size="small"><Lock size={12} /> read-only</Badge>}
              </div>
              <div className="panel__body">
                {!service && <p className="muted">Select a secret from the list to see its fields.</p>}
                {service && !writable && caps && <div className="notice warning small">{deniedReason(caps, currentPath, 'update')}</div>}
                {secretQ.isLoading && <div className="state"><div className="spinner" /></div>}
                {secretQ.isError && <ErrorState error={secretQ.error} onRetry={() => void secretQ.refetch()} />}
                {secretQ.data && (
                  <>
                    {Object.entries(secretQ.data.data.data).length === 0 && <EmptyState title="Empty secret">This secret has no fields yet.</EmptyState>}
                    {Object.entries(secretQ.data.data.data).map(([key, value]) => <SecretField key={key} name={key} value={value} />)}
                    <div className="divider" />
                    <div className="meta-row">
                      <span>Version {secretQ.data.data.metadata.version}</span>
                      <span>·</span>
                      <span>Updated {formatWhen(secretQ.data.data.metadata.created_time)}</span>
                      {secretQ.data.data.metadata.custom_metadata?.rotation_notes && (
                        <>
                          <span>·</span>
                          <span>Rotation: {secretQ.data.data.metadata.custom_metadata.rotation_notes}</span>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                      <Button size="small" icon={<Pencil size={15} />} onClick={() => void openEdit()} disabled={!writable}>
                        Edit
                      </Button>
                      <Button size="small" variant="outlined" icon={<FileJson size={15} />} onClick={() => void copy(envFile(secretQ.data!.data.data), 'Shell-safe .env copied')}>
                        Copy .env
                      </Button>
                      <Button size="small" variant="outlined" icon={<ArrowRightLeft size={15} />} onClick={() => setPromoteTo(envs.find((name) => name !== env) ?? null)} disabled={!writable || envs.length < 2}>
                        Promote to…
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel__head"><History size={17} /><h3>Version history</h3></div>
              <div className="panel__body">
                {metadataQ.isLoading && <div className="state"><div className="spinner" /></div>}
                {metadataQ.data && Object.entries(metadataQ.data.data.versions)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .slice(0, 8)
                  .map(([v, meta]) => (
                    <button
                      key={v}
                      className={`list-item ${version === Number(v) || (version === undefined && Number(v) === metadataQ.data?.data.current_version) ? 'selected' : ''}`}
                      onClick={() => setVersion(Number(v) === metadataQ.data?.data.current_version ? undefined : Number(v))}
                    >
                      <span className="list-item__main">
                        <span className="list-item__title">Version {v}{meta.destroyed ? ' · destroyed' : ''}</span>
                        <span className="list-item__sub">{formatWhen(meta.created_time)}</span>
                      </span>
                      {Number(v) === metadataQ.data.data.current_version && <Badge variant="success" size="small">current</Badge>}
                    </button>
                  ))}
              </div>
            </div>

            <RecentActivityPanel path={apiPath || undefined} />
          </div>
        </div>
      )}

      {promoteTo && project && env && service && secretQ.data && (
        <Dialog
          title={`Promote ${service} to ${promoteTo}`}
          onClose={() => setPromoteTo(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setPromoteTo(null)}>Cancel</Button>
              <Button icon={<ArrowRightLeft size={15} />} onClick={() => void promote()}>Promote values</Button>
            </>
          }
        >
          <p className="small muted">
            This copies the {env} version into <span className="mono">{project}/env/{promoteTo}/{service}</span>.
            Review the destination first — existing values will be replaced.
          </p>
          <TargetPreview project={project} env={promoteTo} service={service} />
          <div className="notice warning small">
            The destination is written with your current token. Your audit log records the write.
          </div>
        </Dialog>
      )}

      {editor && project && env && (
        <Dialog
          title={editor.mode === 'create' ? `New secret in ${env}` : `Edit ${editor.name}`}
          onClose={() => setEditor(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
              <Button
                icon={<Lock size={15} />}
                onClick={() => void saveEditor()}
                loading={saving}
                disabled={saving}
              >
                {editor.mode === 'create' ? 'Create secret' : `Save version ${editor.cas + 1}`}
              </Button>
            </>
          }
        >
          {editor.mode === 'create' ? (
            <div className="field">
              <label htmlFor="secret-name">Secret name</label>
              <input
                id="secret-name"
                className="mono"
                autoFocus
                placeholder="e.g. web"
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
              <p className="small muted">Stored at <span className="mono">kv/data/{project}/env/{env}/&lt;name&gt;</span></p>
            </div>
          ) : (
            <p className="small muted">
              Editing <span className="mono">kv/data/{project}/env/{env}/{editor.name}</span>.
            </p>
          )}

          <div className="divider" />

          <div className="field-editor">
            <div className="field-editor__head">
              <span className="section-title">Fields</span>
              <label className="check-row">
                <input type="checkbox" checked={revealValues} onChange={(event) => setRevealValues(event.target.checked)} />
                Show values
              </label>
            </div>
            {editor.rows.map((row) => (
              <div className="field-editor__row" key={row.id} data-testid={`edit-row-${row.key || 'new'}`}>
                <input
                  aria-label="Field name"
                  className="mono"
                  placeholder="FIELD_NAME"
                  value={row.key}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                />
                <input
                  aria-label="Field value"
                  className="mono"
                  type={revealValues ? 'text' : 'password'}
                  placeholder="value"
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
                <button
                  className="icon-btn"
                  aria-label={`Remove ${row.key || 'field'}`}
                  title="Remove field"
                  onClick={() => setEditor({ ...editor, rows: editor.rows.filter((item) => item.id !== row.id) })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <Button size="small" variant="ghost" icon={<Plus size={14} />} onClick={addRow}>Add field</Button>
          </div>

          {editorError && <div className="notice error small" role="alert">{editorError}</div>}

          <div className="notice small">
            {editor.mode === 'create'
              ? 'Check-and-set: this create only succeeds if the name is still unused (CAS 0).'
              : `Check-and-set: this save only succeeds if version ${editor.cas} is still current. If someone changes it first, you'll get a conflict instead of an overwrite.`}
            {' '}Your token and the write are recorded in the audit log.
          </div>
        </Dialog>
      )}
    </div>
  );
}
