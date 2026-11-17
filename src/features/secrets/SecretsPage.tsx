import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Database,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  History,
  KeyRound,
  Lock,
  Search,
  TerminalSquare,
} from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { envRank, secretApiPath, secretPath } from '@/lib/baoPaths';
import { envFile, formatWhen, mask } from '@/lib/format';
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
  const writable = can(caps, currentPath, 'update') || can(caps, currentPath, 'create');
  const filteredServices = (services.data ?? []).filter((name) => name.toLowerCase().includes(filter.toLowerCase()));

  async function promote() {
    if (!project || !env || !service || !promoteTo || !secretQ.data) return;
    const target = secretPath(project, promoteTo, service);
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
    </div>
  );
}
