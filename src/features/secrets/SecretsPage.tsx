import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ChevronRight,
  ClipboardPaste,
  Columns3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Folder,
  FolderOpen,
  KeyRound,
  Link2,
  Lock,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Tag,
  Upload,
  UserRound,
} from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { envMetadataPath, envRank, secretApiPath, secretPath } from '@/lib/baoPaths';
import { envFile, formatWhen, mask } from '@/lib/format';
import { pushRecent } from '@/lib/navigationMemory';
import { dataFromRows, rowsFromData, validateRows, type FieldRow } from '@/lib/secretForm';
import { buildReferenceLookup, findReferences, resolveReferences, parseKeyValueText, serializeKeyValue, type ImportFormat } from '@/lib/secretFormats';
import {
  effectiveValue,
  mergeAnnotations,
  overridesFor,
  parseAnnotations,
  withOverridesFor,
  type SecretAnnotations,
} from '@/lib/secretMetadata';
import { buildSecretTree, folderBreadcrumbs, folderInTree, secretName, validSecretPath, type SecretTreeFolder } from '@/lib/secretTree';
import { environmentTabs, groupFieldsByPrefix } from '@/lib/secretGroups';
import { useAuth } from '@/lib/auth';
import {
  capabilityPathsForFolder,
  capabilityProbePath,
  useCapabilities,
  useCredentials,
  useEnvironments,
  useLayoutDiscovery,
  useProjects,
  useSecret,
  useSecretMetadata,
  useSecretPaths,
} from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { useClipboard } from '@/lib/useClipboard';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CopyButton, Dialog, EmptyState, EnvBadge, ErrorState } from '@/components/common/Extras';
import { OnboardingBanner } from '@/features/onboarding/OnboardingBanner';
import { LayoutDiscoveryPanel } from './LayoutDiscoveryPanel';
import { RecentActivityPanel } from './RecentActivityPanel';
import { CompareEnvsPanel } from './CompareEnvsPanel';
import { FieldTable } from './FieldTable';
import { VersionHistoryPanel } from './VersionHistoryPanel';

type Search = Record<string, string | undefined>;

type EditorState = {
  mode: 'create' | 'edit';
  name: string;
  rows: FieldRow[];
  annotations: SecretAnnotations;
  baseMetadata: Record<string, string>;
};

/** Only user-editable parts count, so save state never changes the dirty flag. */
function editorSnapshot(editor: EditorState): string {
  return JSON.stringify({ name: editor.name, rows: editor.rows, annotations: editor.annotations });
}

function SecretField({ name, value, comment, override, resolved, resetKey }: {
  name: string;
  value: unknown;
  comment?: string;
  override?: string;
  resolved?: string;
  /** Changing secret/version re-masks everything, so values never stay open across navigation. */
  resetKey?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [resetKey]);
  // A revealed value re-masks on its own; nothing stays on screen indefinitely.
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), 30_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const overridden = override !== undefined;
  const actual = effectiveValue(name, value, overridden ? { [name]: override! } : {});
  const display = revealed ? actual : mask(value);

  return (
    <div className="secret-field" data-testid={`field-${name}`}>
      <span className="secret-field__key" title={name}>
        {name}
        {overridden && <Badge size="small" variant="info" title="Personal override is applied for this identity"><UserRound size={11} /> override</Badge>}
        {comment && <span className="secret-field__comment" title={comment}><MessageSquareText size={12} /> {comment}</span>}
      </span>
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
        <CopyButton value={actual} label={`Copy ${name}`} />
      </span>
      {resolved && (
        <span className="secret-field__resolved mono" title="Resolved from references in this environment">
          <Link2 size={12} /> {revealed ? resolved : mask(resolved)}
        </span>
      )}
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

function FolderRows({ folder, current, depth, onSelect }: {
  folder: SecretTreeFolder;
  current: string;
  depth: number;
  onSelect: (path: string) => void;
}): ReactElement[] {
  return folder.folders.flatMap((child) => [
    <button
      key={`folder-${child.path}`}
      className={`list-item folder-item ${current === child.path ? 'selected' : ''}`}
      style={{ paddingLeft: `calc(var(--spacing-md) + ${depth * 14}px)` }}
      onClick={() => onSelect(child.path)}
      data-testid={`folder-${child.path}`}
    >
      <Folder size={16} />
      <span className="list-item__main">
        <span className="list-item__title">{child.name}</span>
        <span className="list-item__sub">{child.folders.length + child.secrets.length} items</span>
      </span>
    </button>,
    ...FolderRows({ folder: child, current, depth: depth + 1, onSelect }),
  ]);
}

export function SecretsPage() {
  const navigate = useNavigate({ from: '/secrets' });
  const search = useRouterState({ select: (state) => state.location.search }) as Search;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const copy = useClipboard();
  const { identity } = useAuth();
  const identityName = identity?.display_name || identity?.name || 'local';

  const projects = useProjects();
  const [project, setProject] = useState<string | undefined>(search.project);
  const discovery = useLayoutDiscovery(project);
  const environments = useEnvironments(project);
  const envs = useMemo(() => [...(environments.data ?? [])].sort(envRank), [environments.data]);
  const [env, setEnv] = useState<string | undefined>(search.env);
  const pathsQ = useSecretPaths(project, env);
  const tree = useMemo(() => buildSecretTree(pathsQ.data ?? []), [pathsQ.data]);
  const allPaths = useMemo(() => pathsQ.data ?? [], [pathsQ.data]);
  const [folder, setFolder] = useState<string>(search.folder ?? '');
  const [service, setService] = useState<string | undefined>(search.service);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'env' | 'creds'>('env');
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [promoteTo, setPromoteTo] = useState<string | null>(null);
  const [confirmCopyEnv, setConfirmCopyEnv] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBaseline, setEditorBaseline] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealValues, setRevealValues] = useState(false);
  const [dialog, setDialog] = useState<'bulk' | 'import' | 'export' | 'source' | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [importFormat, setImportFormat] = useState<ImportFormat>('env');
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ImportFormat>('env');
  const [sourceEnv, setSourceEnv] = useState<string | null>(null);

  useEffect(() => {
    if (!project && projects.data?.length) setProject(search.project ?? projects.data[0]);
  }, [projects.data, project, search.project]);

  useEffect(() => {
    if (!env && envs.length) {
      setEnv(search.env && envs.includes(search.env) ? search.env : envs[0]);
      setFolder(search.folder ?? '');
      setService(search.service);
    }
  }, [envs, env, search.env, search.folder, search.service]);

  useEffect(() => {
    if (!allPaths.length || service) return;
    const inFolder = allPaths.filter((path) => {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      return parent === folder;
    });
    if (!inFolder.length) return;
    const preferred = search.service && inFolder.includes(search.service) ? search.service : inFolder[0];
    setService(preferred);
  }, [allPaths, service, folder, search.service]);

  useEffect(() => {
    if (project && env) {
      void navigate({
        to: '/secrets',
        search: { project, env, service, folder: folder || undefined },
        replace: true,
      });
    }
  }, [project, env, service, folder, navigate]);

  // Remember only the path of the secret the user opens — never its values.
  useEffect(() => {
    if (project && env && service) pushRecent({ project, env, path: service });
  }, [project, env, service]);

  const capsQ = useCapabilities(capabilityPathsForFolder(project, env, folder, allPaths, envs));
  const caps = capsQ.data;
  const secretQ = useSecret(project, env, service, version);
  const metadataQ = useSecretMetadata(project, env, service);
  // Values for ${path.FIELD} previews. Reads are masked in the UI and never shown in snippets.
  const refQueries = useQueries({
    queries: allPaths.map((path) => ({
      queryKey: ['secret', project, env, path, 'refs'],
      queryFn: () => bao.readSecret(secretApiPath(project!, env!, path)),
      enabled: Boolean(project && env),
      retry: false,
      staleTime: 15_000,
    })),
  });
  const referenceLookup = useMemo(() => buildReferenceLookup(
    allPaths.flatMap((path, index) => refQueries[index]?.data ? [{ path, data: refQueries[index].data!.data.data }] : []),
  ), [allPaths, refQueries]);
  // refQueries already reads each secret in this environment, so field names
  // for filtering come for free — no extra KV reads just to power the filter.
  const fieldNamesByPath = useMemo(() => Object.fromEntries(allPaths.map((path, index) => [
    path,
    Object.keys(refQueries[index]?.data?.data?.data ?? {}),
  ])), [allPaths, refQueries]);
  const annotations = useMemo(() => parseAnnotations(metadataQ.data?.data.custom_metadata), [metadataQ.data]);
  const myOverrides = useMemo(() => overridesFor(annotations, identityName), [annotations, identityName]);

  const currentPath = project && env && service ? secretPath(project, env, service) : '';
  const apiPath = project && env && service ? secretApiPath(project, env, service) : '';
  const probe = project && env ? capabilityProbePath(project, env, allPaths, folder) : '';
  const newPath = probe ? `kv/data/${probe}` : '';
  const metaWritePath = currentPath ? currentPath.replace(/^kv\/data\//, 'kv/metadata/') : '';
  const writable = can(caps, currentPath, 'update') || can(caps, currentPath, 'create');
  const canCreate = can(caps, newPath, 'create') || can(caps, newPath, 'update');
  const canWriteMeta = can(caps, metaWritePath, 'update') ||
    Boolean(probe && can(caps, `kv/metadata/${probe}`, 'create'));
  const folderNode = folderInTree(tree, folder) ?? tree;
  const filterText = filter.trim().toLowerCase();
  const filteredSecrets = folderNode.secrets.filter((path) => {
    if (!filterText) return true;
    return secretName(path).toLowerCase().includes(filterText)
      || (fieldNamesByPath[path] ?? []).some((name) => name.toLowerCase().includes(filterText));
  });
  const crumbs = folderBreadcrumbs(folder);
  const envView = environmentTabs(envs, env);
  const fieldGroups = useMemo(
    () => groupFieldsByPrefix(secretQ.data?.data.data ?? {}),
    [secretQ.data],
  );
  const resetKey = `${project ?? ''}/${env ?? ''}/${service ?? ''}/${version ?? 'latest'}`;

  function updateRow(id: string, patch: Partial<FieldRow>) {
    setEditor((current) => {
      if (!current) return current;
      const oldKey = current.rows.find((row) => row.id === id)?.key.trim() ?? '';
      const nextKey = (patch.key ?? oldKey).trim();
      let annotations = current.annotations;
      // Keep comments and personal overrides attached to a field when it is renamed.
      if (oldKey && nextKey && oldKey !== nextKey) {
        const comments = { ...annotations.comments };
        if (comments[oldKey] !== undefined) {
          comments[nextKey] = comments[oldKey];
          delete comments[oldKey];
        }
        const own = { ...overridesFor(annotations, identityName) };
        if (own[oldKey] !== undefined) {
          own[nextKey] = own[oldKey];
          delete own[oldKey];
        }
        annotations = withOverridesFor({ ...annotations, comments }, identityName, own);
      }
      return {
        ...current,
        rows: current.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        annotations,
      };
    });
  }

  function removeRow(id: string) {
    setEditor((current) => current && { ...current, rows: current.rows.filter((row) => row.id !== id) });
  }

  function addRow() {
    setEditor((current) => current && {
      ...current,
      rows: [...current.rows, { id: `new-${Date.now()}-${current.rows.length}`, key: '', value: '' }],
    });
  }

  function setComment(key: string, value: string) {
    setEditor((current) => current && {
      ...current,
      annotations: { ...current.annotations, comments: { ...current.annotations.comments, [key]: value } },
    });
  }

  function setOverride(key: string, value: string | null) {
    setEditor((current) => {
      if (!current) return current;
      const own = { ...overridesFor(current.annotations, identityName) };
      if (value === null) delete own[key];
      else own[key] = value;
      return { ...current, annotations: withOverridesFor(current.annotations, identityName, own) };
    });
  }

  function setTags(value: string) {
    const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
    setEditor((current) => current && { ...current, annotations: { ...current.annotations, tags } });
  }

  function applyImported(data: Record<string, string>, mode: 'merge' | 'replace') {
    setEditor((current) => {
      if (!current) return current;
      const stamp = Date.now();
      const incoming = rowsFromData(data).map((row) => ({ ...row, id: `import-${stamp}-${row.id}` }));
      const rows = mode === 'replace'
        ? incoming
        : [...current.rows.filter((row) => row.key.trim() && !(row.key.trim() in data)), ...incoming];
      return { ...current, rows };
    });
  }

  function applyBulk() {
    const result = parseKeyValueText(bulkText, 'tsv');
    if (result.error) {
      setBulkError(result.error);
      return;
    }
    applyImported(result.data, 'merge');
    setBulkText('');
    setBulkError(null);
    setDialog(null);
    addToast('success', `${Object.keys(result.data).length} fields staged`, 'Save the secret to write them.');
  }

  function applyImport() {
    const result = parseKeyValueText(importText, importFormat);
    if (result.error) {
      setImportError(result.error);
      return;
    }
    applyImported(result.data, importMode);
    setImportText('');
    setImportError(null);
    setDialog(null);
    addToast('success', `Imported ${Object.keys(result.data).length} fields from ${importFormat.toUpperCase()}`, 'Review the table before saving.');
  }

  function downloadExport() {
    if (!editor) return;
    const text = serializeKeyValue(dataFromRows(editor.rows), exportFormat);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${editor.name.replace(/[^\w.-]+/g, '_') || 'secret'}.${exportFormat === 'env' ? 'env' : exportFormat}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function openCreate() {
    setEditorError(null);
    setDialog(null);
    setConfirmDiscard(false);
    const next: EditorState = {
      mode: 'create',
      name: folder ? `${folder}/` : '',
      rows: [{ id: 'new-0', key: '', value: '' }],
      annotations: { tags: [], note: '', comments: {}, overrides: {} },
      baseMetadata: {},
    };
    setEditor(next);
    setEditorBaseline(editorSnapshot(next));
  }

  async function openEdit() {
    if (!project || !env || !service) return;
    setEditorError(null);
    setDialog(null);
    setConfirmDiscard(false);
    try {
      // Always edit the latest version, even if an older version is being viewed.
      const api = secretApiPath(project, env, service);
      const [latest, meta] = await Promise.all([bao.readSecret(api), bao.readMetadata(api)]);
      const next: EditorState = {
        mode: 'edit',
        name: service,
        rows: rowsFromData(latest.data.data),
        annotations: parseAnnotations(meta.data.custom_metadata),
        baseMetadata: meta.data.custom_metadata ?? {},
      };
      setEditor(next);
      setEditorBaseline(editorSnapshot(next));
    } catch (error) {
      addToast('error', 'Could not load the secret', error instanceof Error ? error.message : undefined);
    }
  }

  async function saveEditor() {
    if (!project || !env || !editor) return;
    const name = editor.name.trim();
    if (!validSecretPath(name)) {
      setEditorError('Give the secret a path relative to this environment, for example database/postgres.');
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
      // bao path helpers add their own prefixes; pass the bare API path.
      const bare = secretApiPath(project, env, name);
      const data = dataFromRows(editor.rows);
      if (editor.mode === 'edit') {
        // PATCH writes only the fields we send and never trips a stale CAS, so
        // a retry after a partial failure cannot block or corrupt the save.
        await bao.patchSecret(bare, data);
      } else {
        // CAS 0 makes creation fail instead of overwriting an existing secret.
        await bao.writeSecret(bare, data, 0);
      }

      // Metadata is a separate KV endpoint. Keep it best-effort and report the
      // outcome honestly: a metadata failure does not mean the data was lost.
      let annotationsSaved = !canWriteMeta;
      if (canWriteMeta) {
        try {
          await bao.writeCustomMetadata(bare, mergeAnnotations(editor.baseMetadata, editor.annotations));
          annotationsSaved = true;
        } catch {
          annotationsSaved = false;
        }
      }
      await queryClient.invalidateQueries();
      if (annotationsSaved) {
        addToast('success', editor.mode === 'create' ? 'Secret created' : 'Secret saved', `kv/data/${bare} · values saved`);
      } else {
        addToast(
          'warning',
          'Values saved, annotations skipped',
          canWriteMeta
            ? 'The secret data was written, but KV metadata could not be updated.'
            : 'Your token cannot write KV metadata; tags, comments and overrides were not stored.',
        );
      }
      setService(name);
      setFolder(name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');
      setVersion(undefined);
      setEditor(null);
      setDialog(null);
    } catch (error) {
      // With PATCH (and CAS 0 for creates) a retry cannot hit a stale-version
      // conflict, so the original error is safe to show as-is.
      setEditorError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const sourceQuery = useQuery({
    queryKey: ['secret', project, sourceEnv, editor?.name, 'source-import'],
    queryFn: () => bao.readSecret(secretApiPath(project!, sourceEnv!, editor!.name)),
    enabled: Boolean(project && sourceEnv && editor && sourceEnv !== env),
    retry: false,
  });

  function applySourceValues() {
    if (!sourceQuery.data) return;
    applyImported(
      Object.fromEntries(Object.entries(sourceQuery.data.data.data).map(([key, value]) => [key, String(value ?? '')])),
      'merge',
    );
    addToast('success', `Staged values from ${sourceEnv}`, 'Review the table before saving.');
    setDialog(null);
    setSourceEnv(null);
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
      <OnboardingBanner />
      <div className="page__header">
        <h2>Secrets</h2>
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
          {envs.length <= 1 ? (
            <div className="env-label" aria-label="Environment">{envs[0] ?? '—'}</div>
          ) : (
            <div className="env-tabs" role="group" aria-label="Environment">
              {envView.tabs.map((name) => {
                const allowed = can(caps, project ? envMetadataPath(project, name) : '', 'list');
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
              {envView.more.length > 0 && (
                <select
                  aria-label="More environments"
                  value={env && envView.more.includes(env) ? env : ''}
                  onChange={(event) => { if (event.target.value) { setEnv(event.target.value); setService(undefined); setVersion(undefined); } }}
                >
                  <option value="">+{envView.more.length} more</option>
                  {envView.more.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
        <div className="search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Filter services" placeholder="Filter secrets…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
      </div>

      <LayoutDiscoveryPanel
        project={project}
        discovery={discovery.data}
        error={discovery.error}
      />

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
              <h3>Folders</h3>
              <Badge size="small">{filteredSecrets.length}</Badge>
              <Button
                size="small"
                variant="outlined"
                icon={<Plus size={14} />}
                onClick={() => void openCreate()}
                disabled={!canCreate}
                title={canCreate ? 'Create a secret in this folder' : 'Your token cannot create secrets here'}
              >
                New secret
              </Button>
            </div>
            <div style={{ padding: 0 }}>
              {pathsQ.isLoading && <div className="state"><div className="spinner" /></div>}
              {pathsQ.isError && <ErrorState error={pathsQ.error} onRetry={() => void pathsQ.refetch()} />}
              <button
                className={`list-item folder-item ${folder === '' ? 'selected' : ''}`}
                onClick={() => { setFolder(''); setService(undefined); setVersion(undefined); }}
                data-testid="folder-root"
              >
                <FolderOpen size={16} />
                <span className="list-item__main">
                  <span className="list-item__title">Root</span>
                  <span className="list-item__sub">{tree.secrets.length} secrets · {tree.folders.length} folders</span>
                </span>
              </button>
              <FolderRows folder={tree} current={folder} depth={0} onSelect={(path) => { setFolder(path); setService(undefined); setVersion(undefined); }} />
              <div className="divider" style={{ margin: '0.5rem var(--spacing-md)' }} />
              <div className="section-title" style={{ padding: '0 var(--spacing-md)' }}>
                Secrets in {folder || 'root'} ({filteredSecrets.length})
              </div>
              {!pathsQ.isLoading && filteredSecrets.length === 0 && (
                <p className="small muted" style={{ padding: '0 var(--spacing-md)' }}>No secrets in this folder.</p>
              )}
              {filteredSecrets.map((path) => (
                <button
                  key={path}
                  className={`list-item ${service === path ? 'selected' : ''}`}
                  onClick={() => { setService(path); setVersion(undefined); }}
                  data-testid={`secret-${path}`}
                >
                  <Database size={16} />
                  <span className="list-item__main">
                    <span className="list-item__title">{secretName(path)}</span>
                    <span className="list-item__sub">{path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid" style={{ gap: '1rem' }}>
            {showCompare && service && project && (
              <CompareEnvsPanel project={project} path={service} envs={envs} />
            )}
            <div className="panel secret-detail">
              <div className="panel__head secret-detail__head">
                <KeyRound size={17} />
                <h3>{service ? secretName(service) : 'Select a secret'}</h3>
                {env && <EnvBadge env={env} />}
                {version !== undefined && <Badge variant="info" size="small">v{version}</Badge>}
                {!writable && currentPath && <Badge variant="outline" size="small"><Lock size={12} /> read-only</Badge>}
                <Button
                  size="small"
                  variant={showCompare ? 'primary' : 'ghost'}
                  icon={<Columns3 size={15} />}
                  onClick={() => setShowCompare((value) => !value)}
                  disabled={!service}
                  title="Compare this field set across environments"
                >
                  Compare
                </Button>
                <Button size="small" icon={<Pencil size={15} />} onClick={() => void openEdit()} disabled={!writable || !service} data-testid="edit-secret">
                  Edit
                </Button>
                <details className="action-menu">
                  <summary className="btn btn--small btn--outlined" aria-label="More secret actions" title="More actions">
                    <MoreHorizontal size={16} />
                  </summary>
                  <div className="action-menu__items">
                    <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setConfirmCopyEnv(true); }} disabled={!secretQ.data}>
                      <FileJson size={14} /> Copy .env
                    </button>
                    <button onClick={() => void (async () => { await openEdit(); setDialog('import'); })} disabled={!writable || !service}>
                      <Upload size={14} /> Import values…
                    </button>
                    <button onClick={() => void (async () => { await openEdit(); setDialog('export'); })} disabled={!service}>
                      <Download size={14} /> Export values…
                    </button>
                    <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setPromoteTo(envs.find((name) => name !== env) ?? null); }} disabled={!writable || envs.length < 2}>
                      <ArrowRightLeft size={14} /> Promote to…
                    </button>
                  </div>
                </details>
              </div>
              <div className="panel__body secret-detail__body">
                {service && (
                  <nav className="breadcrumbs" aria-label="Secret location">
                    <span className="mono">{project}</span>
                    <ChevronRight size={13} />
                    <span className="mono">{env}</span>
                    {crumbs.map((crumb) => (
                      <span key={crumb.path || 'root'} className="breadcrumbs__part">
                        <ChevronRight size={13} />
                        <button className="link-btn mono" onClick={() => { setFolder(crumb.path); setService(undefined); }}>{crumb.label}</button>
                      </span>
                    ))}
                    {service && <><ChevronRight size={13} /><span className="mono strong">{secretName(service)}</span></>}
                  </nav>
                )}
                {!service && <p className="muted">Select a secret from the list to see its fields.</p>}
                {service && !writable && caps && <div className="notice warning small">{deniedReason(caps, currentPath, 'update')}</div>}
                {secretQ.isLoading && <div className="state"><div className="spinner" /></div>}
                {secretQ.isError && <ErrorState error={secretQ.error} onRetry={() => void secretQ.refetch()} />}
                {secretQ.data && (
                  <>
                    {(annotations.tags.length > 0 || annotations.note) && (
                      <div className="annotation-strip">
                        {annotations.tags.map((tag) => <Badge key={tag} size="small" variant="outline"><Tag size={11} /> {tag}</Badge>)}
                        {annotations.note && <span className="small muted"><MessageSquareText size={12} /> {annotations.note}</span>}
                      </div>
                    )}
                    {fieldGroups.length === 0 && <EmptyState title="Empty secret">This secret has no fields yet.</EmptyState>}
                    {fieldGroups.map((group) => (
                      <details key={group.id} className="field-group" data-testid={`field-group-${group.id}`}>
                        <summary>
                          <span>{group.label}</span>
                          <Badge size="small">{group.fields.length}</Badge>
                        </summary>
                        <div className="field-group__fields">
                          {group.fields.map(([key, value]) => {
                            const refs = findReferences(String(value ?? ''));
                            return (
                              <SecretField
                                key={key}
                                name={key}
                                value={value}
                                comment={annotations.comments[key]}
                                override={Object.prototype.hasOwnProperty.call(myOverrides, key) ? myOverrides[key] : undefined}
                                resolved={refs.length > 0 ? resolveReferences(String(value ?? ''), referenceLookup) : undefined}
                                resetKey={resetKey}
                              />
                            );
                          })}
                        </div>
                      </details>
                    ))}
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
                  </>
                )}
              </div>
            </div>

            {project && env && service && (
              <VersionHistoryPanel
                project={project}
                env={env}
                service={service}
                apiPath={apiPath}
                selectedVersion={version}
                onSelectVersion={setVersion}
                canRestore={writable}
              />
            )}

            <RecentActivityPanel path={apiPath || undefined} />
          </div>
        </div>
      )}

      {confirmCopyEnv && secretQ.data && service && (
        <Dialog
          title="Copy real values to the clipboard?"
          onClose={() => setConfirmCopyEnv(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setConfirmCopyEnv(false)}>Cancel</Button>
              <Button
                icon={<FileJson size={15} />}
                onClick={() => {
                  void copy(envFile(secretQ.data!.data.data), 'Shell-safe .env copied');
                  setConfirmCopyEnv(false);
                }}
              >
                Copy .env
              </Button>
            </>
          }
        >
          <p className="small muted">
            This places the unmasked values for <span className="mono">{secretPath(project!, env!, service)}</span> on your clipboard.
            Anything on the clipboard can be pasted into chat, tickets or terminals by any app you use.
          </p>
          <div className="notice warning small">The values are not logged or stored by the console, but they will leave the masked view.</div>
        </Dialog>
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
            This copies the {env} version into <span className="mono">{secretPath(project, promoteTo, service)}</span>.
            Review the destination first — existing values will be replaced.
          </p>
          <TargetPreview project={project} env={promoteTo} service={service} />
          <div className="notice warning small">
            The destination is written with your current token. Your audit log records the write.
          </div>
        </Dialog>
      )}

      {confirmDiscard && (
        <Dialog
          title="Discard unsaved changes?"
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={() => { setConfirmDiscard(false); setEditor(null); setEditorBaseline(''); }}>Discard changes</Button>
            </>
          }
        >
          <p className="small muted">Your staged field, tag and note changes have not been written to OpenBao and will be lost.</p>
        </Dialog>
      )}

      {editor && project && env && (
        <Dialog
          title={editor.mode === 'create' ? `New secret in ${env}` : `Edit ${editor.name}`}
          onClose={() => { if (dialog) setDialog(null); else setEditor(null); }}
          guardClose={() => {
            // Nested dialogs (import, export, bulk) handle their own Escape.
            if (dialog || confirmDiscard) return false;
            if (editorBaseline && editorSnapshot(editor) !== editorBaseline) {
              setConfirmDiscard(true);
              return false;
            }
            return true;
          }}
          footer={
            <>
              <Button variant="outlined" onClick={() => {
                if (editorBaseline && editorSnapshot(editor) !== editorBaseline) setConfirmDiscard(true);
                else setEditor(null);
              }} disabled={saving}>Cancel</Button>
              <Button
                icon={<Lock size={15} />}
                onClick={() => void saveEditor()}
                loading={saving}
                disabled={saving}
              >
                {editor.mode === 'create' ? 'Create secret' : 'Save changes'}
              </Button>
            </>
          }
        >
          {editor.mode === 'create' ? (
            <div className="field">
              <label htmlFor="secret-name">Secret path (relative to environment)</label>
              <input
                id="secret-name"
                className="mono"
                autoFocus
                placeholder="e.g. database/postgres"
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
              <p className="small muted">Stored at <span className="mono">kv/data/{project && env ? secretApiPath(project, env, editor.name) : '<path>'}</span></p>
            </div>
          ) : (
            <p className="small muted">
              Editing <span className="mono">{apiPath}</span>.
            </p>
          )}

          <div className="field-grid">
            <div className="field">
              <label htmlFor="secret-tags"><Tag size={12} /> Tags (comma separated)</label>
              <input
                id="secret-tags"
                placeholder="database, critical"
                value={editor.annotations.tags.join(', ')}
                onChange={(event) => setTags(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="secret-note"><MessageSquareText size={12} /> Note for this secret</label>
              <input
                id="secret-note"
                placeholder="e.g. rotate weekly with the DBA team"
                value={editor.annotations.note}
                onChange={(event) => setEditor({ ...editor, annotations: { ...editor.annotations, note: event.target.value } })}
              />
            </div>
          </div>

          <div className="divider" />

          <div className="field-editor">
            <div className="field-editor__head">
              <span className="section-title">Fields ({editor.rows.length})</span>
              <div className="field-editor__tools">
                <label className="check-row">
                  <input type="checkbox" checked={revealValues} onChange={(event) => setRevealValues(event.target.checked)} />
                  Show all values
                </label>
                <Button size="small" variant="ghost" icon={<Plus size={14} />} onClick={addRow}>Add field</Button>
                <Button size="small" variant="ghost" icon={<ClipboardPaste size={14} />} onClick={() => { setBulkError(null); setDialog('bulk'); }}>Bulk paste</Button>
                <Button size="small" variant="ghost" icon={<Upload size={14} />} onClick={() => { setImportError(null); setDialog('import'); }}>Import</Button>
                <Button size="small" variant="ghost" icon={<Download size={14} />} onClick={() => setDialog('export')}>Export</Button>
                {editor.mode === 'edit' && envs.length > 1 && (
                  <Button size="small" variant="ghost" icon={<ArrowRightLeft size={14} />} onClick={() => { setSourceEnv(null); setDialog('source'); }}>From env…</Button>
                )}
              </div>
            </div>
            <FieldTable
              rows={editor.rows}
              revealAll={revealValues}
              comments={editor.annotations.comments}
              overrides={overridesFor(editor.annotations, identityName)}
              lookup={referenceLookup}
              onRowChange={updateRow}
              onRemove={removeRow}
              onCommentChange={setComment}
              onOverrideChange={setOverride}
            />
          </div>

          {editorError && <div className="notice error small" role="alert">{editorError}</div>}

          <div className="notice small">
            {editor.mode === 'create'
              ? 'Check-and-set: this create only succeeds if the name is still unused (CAS 0).'
              : 'This save patches only the fields you changed, so a concurrent edit to a different field cannot cause a conflict.'}
            {' '}Values go to KV data; tags, comments and personal overrides go to KV custom metadata. Your token and the write are recorded in the audit log.
            {!canWriteMeta && ' Your token cannot write metadata, so annotations will be skipped.'}
          </div>
        </Dialog>
      )}

      {dialog === 'bulk' && editor && (
        <Dialog
          title="Bulk add fields"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setDialog(null)}>Cancel</Button>
              <Button icon={<ClipboardPaste size={15} />} onClick={applyBulk}>Add fields</Button>
            </>
          }
        >
          <p className="small muted">
            Paste spreadsheet rows, one per line: <code>KEY&lt;tab&gt;value</code>. Comma-separated rows work too.
            Existing fields with the same name are replaced.
          </p>
          <div className="field">
            <label htmlFor="bulk-text">Rows</label>
            <textarea
              id="bulk-text"
              className="mono"
              rows={8}
              autoFocus
              placeholder={'HOST\tpg.internal\nPORT\t5432'}
              value={bulkText}
              onChange={(event) => { setBulkText(event.target.value); setBulkError(null); }}
            />
          </div>
          {bulkError && <div className="notice error small" role="alert">{bulkError}</div>}
        </Dialog>
      )}

      {dialog === 'import' && editor && (
        <Dialog
          title="Import fields"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setDialog(null)}>Cancel</Button>
              <Button icon={<Upload size={15} />} onClick={applyImport}>Import</Button>
            </>
          }
        >
          <div className="field-grid">
            <div className="field">
              <label htmlFor="import-format">Format</label>
              <select id="import-format" value={importFormat} onChange={(event) => setImportFormat(event.target.value as ImportFormat)}>
                <option value="env">.env</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="tsv">TSV / pasted table</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="import-file">Or choose a file</label>
              <input
                id="import-file"
                type="file"
                accept=".env,.json,.yaml,.yml,.tsv,.txt"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setImportText(await file.text());
                    setImportError(null);
                  }
                }}
              />
            </div>
          </div>
          <div className="check-row">
            <input type="checkbox" checked={importMode === 'replace'} onChange={(event) => setImportMode(event.target.checked ? 'replace' : 'merge')} />
            Replace all staged fields (otherwise imported names merge into the table)
          </div>
          <div className="field">
            <label htmlFor="import-text">Paste content</label>
            <textarea
              id="import-text"
              className="mono"
              rows={9}
              value={importText}
              placeholder={importFormat === 'json' ? '{"KEY": "value"}' : 'KEY=value'}
              onChange={(event) => { setImportText(event.target.value); setImportError(null); }}
            />
          </div>
          {importError && <div className="notice error small" role="alert">{importError}</div>}
          {!importError && importText.trim() && (
            <p className="small muted">{Object.keys(parseKeyValueText(importText, importFormat).data).length} fields detected.</p>
          )}
        </Dialog>
      )}

      {dialog === 'export' && editor && (
        <Dialog
          title={`Export as ${exportFormat.toUpperCase()}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outlined" icon={<Download size={15} />} onClick={downloadExport}>Download</Button>
              <CopyButton value={serializeKeyValue(dataFromRows(editor.rows), exportFormat)} label="Copy export" />
            </>
          }
        >
          <div className="field">
            <label htmlFor="export-format">Format</label>
            <select id="export-format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ImportFormat)}>
              <option value="env">.env</option>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="tsv">TSV / spreadsheet</option>
            </select>
          </div>
          <div className="notice warning small">
            The preview contains real secret values. Copy or download it only into a trusted place.
          </div>
          <pre className="export-preview mono" data-testid="export-preview">{serializeKeyValue(dataFromRows(editor.rows), exportFormat)}</pre>
        </Dialog>
      )}

      {dialog === 'source' && editor && (
        <Dialog
          title="Import values from another environment"
          onClose={() => { setDialog(null); setSourceEnv(null); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => { setDialog(null); setSourceEnv(null); }}>Cancel</Button>
              <Button icon={<ArrowRightLeft size={15} />} onClick={applySourceValues} disabled={!sourceQuery.data}>Stage values</Button>
            </>
          }
        >
          <p className="small muted">
            Pull fields from <span className="mono">{project}/env/&lt;environment&gt;/{editor.name}</span> into this draft.
            Nothing is written until you save.
          </p>
          <div className="env-switch" role="group" aria-label="Source environment">
            {envs.filter((name) => name !== env).map((name) => (
              <button key={name} aria-pressed={sourceEnv === name} onClick={() => setSourceEnv(name)}>{name}</button>
            ))}
          </div>
          {sourceEnv && sourceQuery.isLoading && <div className="state"><div className="spinner" /></div>}
          {sourceEnv && sourceQuery.isError && <div className="notice warning small">The source secret is not readable with this token.</div>}
          {sourceQuery.data && (
            <div className="grid">
              {Object.entries(sourceQuery.data.data.data).map(([key, value]) => (
                <div className="secret-field" key={key}>
                  <span className="secret-field__key">{key}</span>
                  <span className="secret-field__value masked">{mask(value)}</span>
                  <span />
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
