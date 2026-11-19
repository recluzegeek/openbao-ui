import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useBlocker, useNavigate, useRouterState } from '@tanstack/react-router';
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
  Tag,
  Trash2,
  Undo2,
  Upload,
  UserRound,
} from 'lucide-react';
import { bao, BaoError, type CapabilitiesMap } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { envRank, secretApiPath, secretPath } from '@/lib/baoPaths';
import { envFile, formatWhen, mask } from '@/lib/format';
import { pushRecent } from '@/lib/navigationMemory';
import { countFieldChanges, dataFromRows, rowsFromData, validateRows, type FieldRow } from '@/lib/secretForm';
import { buildReferenceLookup, findReferences, resolveReferences, parseKeyValueText, serializeKeyValue, type ImportFormat } from '@/lib/secretFormats';
import { promotionPreview, promotionSummary, type PromotionPreview } from '@/lib/promotion';
import {
  effectiveValue,
  mergeAnnotations,
  overridesFor,
  parseAnnotations,
  withOverridesFor,
  type SecretAnnotations,
} from '@/lib/secretMetadata';
import { buildSecretTree, folderBreadcrumbs, folderInTree, secretName, validSecretPath, type SecretTreeFolder } from '@/lib/secretTree';
import { groupFieldsByPrefix } from '@/lib/secretGroups';
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
import { SecretSettingsPanel } from './SecretSettingsPanel';

type Search = Record<string, string | undefined>;

/** Stable key for the four scope params the URL and local state share. */
function scopeUrlKey(value: { project?: string; env?: string; service?: string; folder?: string }) {
  return JSON.stringify({
    project: value.project,
    env: value.env,
    service: value.service,
    folder: value.folder || undefined,
  });
}

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

function SecretField({ name, value, comment, override, resolved, resetKey, editable, editing, draftValue, removed, staged, nextField, onStartEdit, onStage, onCancelEdit, onRemove, onUndoRemove }: {
  name: string;
  value: unknown;
  comment?: string;
  override?: string;
  resolved?: string;
  /** Changing secret/version re-masks everything, so values never stay open across navigation. */
  resetKey?: string;
  /** Inline editing is only offered when the token can write this secret. */
  editable?: boolean;
  editing?: boolean;
  draftValue?: string | null;
  removed?: boolean;
  /** A key that does not exist on the server yet. */
  staged?: boolean;
  nextField?: string;
  onStartEdit?: (name: string) => void;
  onStage?: (name: string, value: string, nextField?: string) => void;
  onCancelEdit?: () => void;
  onRemove?: (name: string) => void;
  onUndoRemove?: (name: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => { setRevealed(false); }, [resetKey]);
  useEffect(() => {
    if (editing) setDraft(draftValue ?? String(value ?? ''));
  }, [editing, draftValue, value]);
  // A revealed value re-masks on its own; nothing stays on screen indefinitely.
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), 30_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const overridden = override !== undefined;
  const actual = effectiveValue(name, value, overridden ? { [name]: override! } : {});
  const changed = staged || (draftValue !== undefined && draftValue !== null && draftValue !== String(value ?? ''));
  const display = revealed ? actual : mask(value);

  function stage(next?: string) {
    onStage?.(name, draft, next);
  }

  return (
    <div
      className={`secret-field${removed ? ' secret-field--removed' : ''}${changed ? ' secret-field--changed' : ''}`}
      data-testid={`field-${name}`}
      data-inline-field={name}
    >
      <span className="secret-field__key" title={name}>
        {name}
        {changed && <Badge size="small" variant={staged ? 'success' : 'warning'} title={staged ? 'New key, not saved yet' : 'Staged change, not saved yet'}>{staged ? 'new' : 'staged'}</Badge>}
        {overridden && <Badge size="small" variant="info" title="Personal override is applied for this identity"><UserRound size={11} /> override</Badge>}
        {comment && <span className="secret-field__comment" title={comment}><MessageSquareText size={12} /> {comment}</span>}
      </span>
      {editing ? (
        <span className="secret-field__editor">
          <input
            autoFocus
            className="mono"
            data-testid={`edit-value-${name}`}
            aria-label={`Value for ${name}`}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stage();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit?.();
              } else if (event.key === 'Tab' && !event.shiftKey && nextField) {
                event.preventDefault();
                stage(nextField);
              }
            }}
          />
          <button type="button" className="btn btn--primary btn--small" onMouseDown={(event) => event.preventDefault()} onClick={() => stage()}>
            Stage
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`secret-field__value secret-field__value--button ${revealed ? '' : 'masked'}`}
          onClick={() => (editable ? onStartEdit?.(name) : setRevealed((current) => !current))}
          title={removed ? 'This key will be removed when you save' : editable ? 'Click to edit this value' : revealed ? 'Hide' : 'Reveal'}
          aria-label={editable ? `Edit ${name}` : revealed ? `Hide ${name}` : `Reveal ${name}`}
        >
          {removed ? 'removed on save' : display}
        </button>
      )}
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
        {editable && !editing && (
          <button className="icon-btn" onClick={() => onStartEdit?.(name)} aria-label={`Edit ${name}`} title="Edit this value inline">
            <Pencil size={15} />
          </button>
        )}
        {editable && removed ? (
          <button className="icon-btn" onClick={() => onUndoRemove?.(name)} aria-label={`Keep ${name}`} title="Undo removal">
            <Undo2 size={15} />
          </button>
        ) : editable && (
          <button className="icon-btn" onClick={() => onRemove?.(name)} aria-label={`Remove ${name}`} title="Remove this key on save">
            <Trash2 size={15} />
          </button>
        )}
      </span>
      {resolved && (
        <span className="secret-field__resolved mono" title="Resolved from references in this environment">
          <Link2 size={12} /> {revealed ? resolved : mask(resolved)}
        </span>
      )}
    </div>
  );
}

function ReviewValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), 30_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  return (
    <span className="review-value">
      <span className={`mono ${revealed ? '' : 'masked'}`}>{revealed ? value : mask(value)}</span>
      <button className="icon-btn" onClick={() => setRevealed((current) => !current)} aria-label={revealed ? 'Hide value' : 'Reveal value'} title={revealed ? 'Hide' : 'Reveal'}>
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}

function TargetPreview({ preview, loading, missing, sourceCount }: {
  preview: PromotionPreview;
  loading: boolean;
  missing: boolean;
  sourceCount: number;
}) {
  if (loading) return <div className="state"><div className="spinner" /></div>;
  if (missing) {
    return (
      <div className="notice" data-testid="promote-preview">
        No readable value at the destination. Promotion will create it with {sourceCount} field{sourceCount === 1 ? '' : 's'}.
      </div>
    );
  }
  const groups: Array<{ id: string; label: string; hint: string; variant: 'warning' | 'success' | 'outline' | 'danger'; fields: string[] }> = [
    { id: 'overwritten', label: 'Overwritten', hint: 'Destination value will change', variant: 'warning', fields: preview.overwritten },
    { id: 'added', label: 'Added', hint: 'New field at the destination', variant: 'success', fields: preview.added },
    { id: 'unchanged', label: 'Unchanged', hint: 'Already matches the source', variant: 'outline', fields: preview.unchanged },
    { id: 'removed', label: 'Removed by this write', hint: 'Destination-only fields will be deleted', variant: 'danger', fields: preview.removed },
  ];
  return (
    <div className="grid" data-testid="promote-preview">
      {groups.map((group) => (
        <div key={group.id} data-testid={`promote-group-${group.id}`}>
          <div className="section-title">
            {group.label} <Badge size="small" variant={group.variant}>{group.fields.length}</Badge>
          </div>
          <p className="small muted">{group.hint}</p>
          {group.fields.length === 0 ? (
            <p className="small muted">None</p>
          ) : (
            <div className="method-chips">
              {group.fields.map((name) => (
                <span className="method-chip" key={name} data-testid={`promote-${group.id}-${name}`}>
                  <code>{name}</code>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="small muted">Field names only — values stay masked. Promotion writes the complete source field set, so destination-only fields cannot survive it.</p>
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
        {child.folders.length > 0 && (
          <span className="list-item__sub">{child.folders.length} subfolder{child.folders.length === 1 ? '' : 's'}</span>
        )}
      </span>
      <span className="list-item__count">
        {child.secrets.length} secret{child.secrets.length === 1 ? '' : 's'}
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
  const [tab, setTab] = useState<'env' | 'creds'>('env');
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [promoteTo, setPromoteTo] = useState<string | null>(null);
  const [promoteAck, setPromoteAck] = useState(false);
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
  // Standalone import is independent of the edit dialog — it stages a NEW secret.
  const [importStandalone, setImportStandalone] = useState(false);
  const [importTarget, setImportTarget] = useState('');
  const [exportFormat, setExportFormat] = useState<ImportFormat>('env');
  const [sourceEnv, setSourceEnv] = useState<string | null>(null);
  // Inline editor (Concept A): staged value edits live in memory only and are
  // written with a single `kv patch` for changed keys. Removals need a full
  // write, because merge-patch cannot delete a key.
  const [inlineDraft, setInlineDraft] = useState<Record<string, string | null>>({});
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [inlineAddOpen, setInlineAddOpen] = useState(false);
  const [inlineAddKey, setInlineAddKey] = useState('');
  const [inlineAddValue, setInlineAddValue] = useState('');
  const [inlineAddError, setInlineAddError] = useState<string | null>(null);
  const [inlineReview, setInlineReview] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [savingInline, setSavingInline] = useState(false);
  const [pendingInlineNav, setPendingInlineNav] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!project && projects.data?.length) setProject(search.project ?? projects.data[0]);
  }, [projects.data, project, search.project]);

  // Reconcile the selected environment with the current project. Switching
  // projects used to leave the previous project's env in state/URL, so a
  // single-environment project rendered an empty, non-interactive dead end.
  useEffect(() => {
    if (!envs.length) return;
    const current = env && envs.includes(env) ? env : undefined;
    const fromUrl = search.env && envs.includes(search.env) ? search.env : undefined;
    const next = current ?? fromUrl ?? envs[0];
    if (next !== env) {
      setEnv(next);
      setVersion(undefined);
      // Drop a selection that belonged to the previous environment.
      if (env !== undefined) setService(undefined);
    }
  }, [envs, env, search.env]);

  // The topbar scope switcher changes the URL rather than this component's
  // state, and the router does not remount the page for a search change. Mirror
  // external URL changes back into state, but ignore the URLs this page writes
  // itself so a local click is never reverted by a stale search value.
  const lastWrittenUrl = useRef(scopeUrlKey(search));
  useEffect(() => {
    const incoming = scopeUrlKey(search);
    if (incoming === lastWrittenUrl.current) return;
    lastWrittenUrl.current = incoming;
    if (search.project && search.project !== project) {
      setProject(search.project);
      setEnv(undefined);
      setFolder('');
      setService(undefined);
      setVersion(undefined);
      return;
    }
    if (search.env && search.env !== env && (!envs.length || envs.includes(search.env))) {
      setEnv(search.env);
      setService(undefined);
      setVersion(undefined);
    }
    const nextFolder = search.folder ?? '';
    if (nextFolder !== folder) {
      setFolder(nextFolder);
      setService(undefined);
      setVersion(undefined);
    }
    if (search.service !== service) setService(search.service);
  }, [search, project, env, envs, folder, service]);

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
      lastWrittenUrl.current = scopeUrlKey({ project, env, service, folder });
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
  // A 404 means the path does not exist. It must never be shown as "no access":
  // glob policies can report full capabilities for a path with no secret.
  const secretNotFound = secretQ.error instanceof BaoError && secretQ.error.status === 404;
  const canCreate = can(caps, newPath, 'create') || can(caps, newPath, 'update');
  const canWriteMeta = can(caps, metaWritePath, 'update') ||
    Boolean(probe && can(caps, `kv/metadata/${probe}`, 'create'));
  const folderNode = folderInTree(tree, folder) ?? tree;
  const crumbs = folderBreadcrumbs(folder);
  const fieldGroups = useMemo(
    () => groupFieldsByPrefix(secretQ.data?.data.data ?? {}),
    [secretQ.data],
  );
  const resetKey = `${project ?? ''}/${env ?? ''}/${service ?? ''}/${version ?? 'latest'}`;
  // A different secret, environment or version starts a fresh draft. The guard
  // above asks before that happens; automatic reconciliation clears silently.
  useEffect(() => {
    setInlineDraft({});
    setInlineEditing(null);
    setInlineAddOpen(false);
    setInlineError(null);
  }, [resetKey]);
  const editorChanges = useMemo(() => {
    if (!editor || !editorBaseline) return 0;
    try {
      const base = JSON.parse(editorBaseline) as EditorState;
      return countFieldChanges(dataFromRows(base.rows), dataFromRows(editor.rows))
        + (base.name === editor.name ? 0 : 1)
        + (JSON.stringify(base.annotations) === JSON.stringify(editor.annotations) ? 0 : 1);
    } catch {
      return 0;
    }
  }, [editor, editorBaseline]);

  const inlineBase = secretQ.data?.data.data ?? {};
  const inlineChanges = useMemo(
    () => Object.entries(inlineDraft).filter(([key, value]) => (
      value === null ? Object.prototype.hasOwnProperty.call(inlineBase, key) : String(inlineBase[key] ?? '') !== value
    )),
    [inlineDraft, inlineBase],
  );
  const inlineDirty = inlineChanges.length > 0;
  const inlineOrder = useMemo(() => fieldGroups.flatMap((group) => group.fields.map(([key]) => key)), [fieldGroups]);
  const blocker = useBlocker({
    shouldBlockFn: () => inlineDirty,
    enableBeforeUnload: inlineDirty,
    withResolver: true,
  });

  // Moving to another secret/folder/environment drops the staged values, so ask
  // first. The same guard covers route changes through `useBlocker`.
  function guardInline(run: () => void) {
    if (inlineDirty) setPendingInlineNav(() => run);
    else run();
  }

  function stageInline(key: string, value: string, nextField?: string) {
    setInlineDraft((current) => ({ ...current, [key]: value }));
    setInlineError(null);
    if (nextField) setInlineEditing(nextField);
    else setInlineEditing(null);
  }

  function removeInline(key: string) {
    setInlineDraft((current) => ({ ...current, [key]: null }));
    setInlineEditing(null);
  }

  function undoRemoveInline(key: string) {
    setInlineDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function discardInline() {
    setInlineDraft({});
    setInlineEditing(null);
    setInlineError(null);
    setInlineAddOpen(false);
  }

  function addInlineField() {
    const key = inlineAddKey.trim();
    if (!key) {
      setInlineAddError('Enter a key name.');
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
      setInlineAddError('Use letters, numbers, dot, dash or underscore.');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(inlineBase, key) || Object.prototype.hasOwnProperty.call(inlineDraft, key)) {
      setInlineAddError(`"${key}" already exists in this secret.`);
      return;
    }
    setInlineDraft((current) => ({ ...current, [key]: inlineAddValue }));
    setInlineAddKey('');
    setInlineAddValue('');
    setInlineAddError(null);
    setInlineAddOpen(false);
  }

  async function saveInline() {
    if (!project || !env || !service || !secretQ.data || !inlineDirty) return;
    setSavingInline(true);
    setInlineError(null);
    const before = { ...secretQ.data.data.data };
    const updates: Record<string, string> = {};
    const removals: string[] = [];
    for (const [key, value] of inlineChanges) {
      if (value === null) removals.push(key);
      else updates[key] = value;
    }
    try {
      if (removals.length > 0) {
        // A merge patch cannot delete keys, so removals need a full write. Use
        // CAS so a concurrent edit is reported rather than silently clobbered.
        const next = { ...before };
        for (const key of removals) delete next[key];
        Object.assign(next, updates);
        await bao.writeSecret(apiPath, next, secretQ.data.data.metadata.version);
      } else {
        await bao.patchSecret(
          apiPath,
          updates,
          metadataQ.data?.data.cas_required ? secretQ.data.data.metadata.version : undefined,
        );
      }
      await queryClient.invalidateQueries();
      const summary = [
        Object.keys(updates).length ? `${Object.keys(updates).length} updated` : '',
        removals.length ? `${removals.length} removed` : '',
      ].filter(Boolean).join(' · ');
      addToast(
        'success',
        'Changes saved',
        summary,
        {
          label: 'Undo',
          onClick: () => {
            void bao.writeSecret(apiPath, before)
              .then(() => queryClient.invalidateQueries())
              .then(() => addToast('info', 'Changes undone', 'The previous field set was restored.'))
              .catch((error) => addToast('error', 'Undo failed', error instanceof Error ? error.message : undefined));
          },
        },
      );
      discardInline();
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSavingInline(false);
    }
  }

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

  /** Page-level import never opens the current secret's edit dialog. */
  function openStandaloneImport() {
    setImportStandalone(true);
    setImportTarget(folder ? `${folder}/` : '');
    setImportFormat('env');
    setImportText('');
    setImportError(null);
    setDialog('import');
  }

  function openDraftImport() {
    setImportStandalone(false);
    setImportFormat('env');
    setImportText('');
    setImportError(null);
    setDialog('import');
  }

  function applyImport() {
    const result = parseKeyValueText(importText, importFormat);
    if (result.error) {
      setImportError(result.error);
      return;
    }
    if (importStandalone) {
      const name = importTarget.trim();
      if (!validSecretPath(name)) {
        setImportError('Give the new secret a path relative to this environment, for example database/postgres.');
        return;
      }
      // Stage a fresh create draft. No read of the current secret and no write
      // happens until the user reviews the table and saves (CAS 0).
      const next: EditorState = {
        mode: 'create',
        name,
        rows: rowsFromData(result.data),
        annotations: { tags: [], note: '', comments: {}, overrides: {} },
        baseMetadata: {},
      };
      setEditor(next);
      setEditorBaseline(editorSnapshot(next));
      setImportStandalone(false);
      setImportText('');
      setImportError(null);
      setDialog(null);
      addToast('success', `Staged ${Object.keys(result.data).length} fields from ${importFormat.toUpperCase()}`, 'Review the new secret, then save it to create it.');
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

  function openCreateAt(path: string) {
    setEditorError(null);
    setDialog(null);
    setConfirmDiscard(false);
    const next: EditorState = {
      mode: 'create',
      name: path,
      rows: [{ id: 'new-0', key: '', value: '' }],
      annotations: { tags: [], note: '', comments: {}, overrides: {} },
      baseMetadata: {},
    };
    setEditor(next);
    setEditorBaseline(editorSnapshot(next));
  }

  async function openCreate() {
    openCreateAt(folder ? `${folder}/` : '');
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

  function openAddFieldInline() {
    setInlineAddError(null);
    setInlineAddKey('');
    setInlineAddValue('');
    setInlineAddOpen(true);
    setInlineEditing(null);
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
        // PATCH writes only the fields we send, so a retry after a partial
        // failure cannot block or corrupt the save. If this key has
        // cas-required, pass a freshly read version so concurrent writes still
        // produce a conflict instead of a silent overwrite.
        const casRequired = metadataQ.data?.data.cas_required;
        const cas = casRequired ? (await bao.readSecret(bare)).data.metadata.version : undefined;
        await bao.patchSecret(bare, data, cas);
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

  // Read the promote destination only while its dialog is open. The preview is
  // computed from field names and value comparisons; no value is ever rendered.
  const promoteTargetQ = useQuery({
    queryKey: ['secret', project, promoteTo, service, 'promote-preview'],
    queryFn: () => bao.readSecret(secretApiPath(project!, promoteTo!, service!)),
    enabled: Boolean(project && promoteTo && service),
    retry: false,
  });
  const promoteSource = useMemo(() => secretQ.data?.data.data ?? {}, [secretQ.data]);
  const promoteTarget = useMemo(
    () => promoteTargetQ.isSuccess ? (promoteTargetQ.data.data.data ?? {}) : {},
    [promoteTargetQ.isSuccess, promoteTargetQ.data],
  );
  const promotePreview = useMemo(() => promotionPreview(promoteSource, promoteTarget), [promoteSource, promoteTarget]);
  const promotionNeedsAck = promoteTargetQ.isSuccess && promotePreview.removed.length > 0;

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

  function openPromote(target: string) {
    setPromoteAck(false);
    setPromoteTo(target);
  }

  function closePromote() {
    setPromoteTo(null);
    setPromoteAck(false);
  }

  async function promote() {
    if (!project || !env || !service || !promoteTo || !secretQ.data) return;
    if (promotionNeedsAck && !promoteAck) return;
    const target = secretApiPath(project, promoteTo, service);
    const data = secretQ.data.data.data;
    try {
      await bao.writeSecret(target, data);
      await queryClient.invalidateQueries();
      addToast('success', `Promoted to ${promoteTo}`, `${project}/${service} now matches ${env} · ${promotionSummary(promotePreview)}.`);
      closePromote();
    } catch (error) {
      addToast('error', 'Promotion failed', error instanceof Error ? error.message : undefined);
    }
  }

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <OnboardingBanner />

      <div className="secrets-view-bar">
        <div className="view-switch" role="group" aria-label="Secrets view">
          <button
            type="button"
            aria-pressed={tab === 'env'}
            onClick={() => guardInline(() => setTab('env'))}
            data-testid="view-environments"
          >
            Environments
          </button>
          <button
            type="button"
            aria-pressed={tab === 'creds'}
            onClick={() => guardInline(() => setTab('creds'))}
            data-testid="shared-credentials-tab"
            title="Project-level shared credentials"
          >
            Shared credentials
          </button>
        </div>
      </div>

      <LayoutDiscoveryPanel
        project={project}
        discovery={discovery.data}
        error={discovery.error}
      />

      {tab === 'creds' ? (
        project ? <CredentialsPanel project={project} caps={caps} /> : <EmptyState title="Choose a project" />
      ) : (
        <div className="grid grid--split">
          <div className="panel">
            <div className="panel__head">
              <FolderOpen size={17} />
              <h3>Folders</h3>
              <Button
                size="small"
                variant="outlined"
                icon={<Plus size={14} />}
                onClick={() => void openCreate()}
                disabled={!canCreate}
                title={canCreate ? 'Create a new folder (KV path)' : 'Your token cannot create folders here'}
              >
                New folder
              </Button>
            </div>
            <nav className="folder-crumbs" aria-label="Folder location">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path || 'root'} className="folder-crumbs__part">
                  {index > 0 && <ChevronRight size={12} />}
                  <button
                    className="link-btn mono"
                    onClick={() => guardInline(() => { setFolder(crumb.path); setService(undefined); setVersion(undefined); })}
                    aria-current={folder === crumb.path ? 'location' : undefined}
                  >
                    {index === 0 ? 'Root' : crumb.label}
                  </button>
                </span>
              ))}
            </nav>
            <div style={{ padding: 0 }}>
              {pathsQ.isLoading && <div className="state"><div className="spinner" /></div>}
              {pathsQ.isError && <ErrorState error={pathsQ.error} onRetry={() => void pathsQ.refetch()} />}
              <FolderRows folder={tree} current={folder} depth={0} onSelect={(path) => guardInline(() => { setFolder(path); setService(undefined); setVersion(undefined); })} />
              {!pathsQ.isLoading && tree.folders.length === 0 && folderNode.secrets.length === 0 && (
                <p className="small muted" style={{ padding: '0 var(--spacing-md)' }}>No folders in this project yet.</p>
              )}
              {!pathsQ.isLoading && folderNode.secrets.length === 0 && (
                <p className="small muted" style={{ padding: '0 var(--spacing-md)' }}>
                  No secrets in this folder. Use <strong>New folder</strong> to create a path, or <strong>Import</strong> to add fields.
                </p>
              )}
              {folderNode.secrets.map((path) => {
                const fields = fieldNamesByPath[path]?.length ?? 0;
                return (
                  <button
                    key={path}
                    className={`list-item ${service === path ? 'selected' : ''}`}
                    onClick={() => guardInline(() => { setService(path); setVersion(undefined); })}
                    data-testid={`secret-${path}`}
                  >
                    <Database size={16} />
                    <span className="list-item__main">
                      <span className="list-item__title">{secretName(path)}</span>
                      {path !== secretName(path) && <span className="list-item__sub">{path}</span>}
                    </span>
                    <span className="list-item__count">{fields} field{fields === 1 ? '' : 's'}</span>
                  </button>
                );
              })}
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
                {!writable && currentPath && !secretNotFound && <Badge variant="outline" size="small"><Lock size={12} /> read-only</Badge>}
                {secretNotFound && service ? (
                  <>
                    <Button
                      size="small"
                      variant="primary"
                      icon={<Plus size={15} />}
                      onClick={() => openCreateAt(service)}
                      disabled={!canCreate}
                      title={canCreate ? `Create ${service} in ${env}` : 'Your token cannot create secrets here'}
                      data-testid="create-missing-secret"
                    >
                      Create this secret
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      icon={<Upload size={15} />}
                      onClick={openStandaloneImport}
                      disabled={!canCreate}
                      title={canCreate ? 'Create a new secret from pasted fields' : 'Your token cannot create secrets here'}
                    >
                      Import
                    </Button>
                  </>
                ) : service ? (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      icon={<Plus size={15} />}
                      onClick={openAddFieldInline}
                      disabled={!writable}
                      data-testid="inline-add-field"
                      title={writable ? 'Add a key to this secret' : 'Your token cannot add keys here'}
                    >
                      Add key
                    </Button>
                    <Button
                      size="small"
                      variant={showCompare ? 'primary' : 'ghost'}
                      icon={<Columns3 size={15} />}
                      onClick={() => setShowCompare((value) => !value)}
                      title="Compare this field set across environments"
                    >
                      Compare
                    </Button>
                    <Button size="small" icon={<Pencil size={15} />} onClick={() => void openEdit()} disabled={!writable} data-testid="edit-secret">
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
                        <button
                          data-testid="open-import"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            openStandaloneImport();
                          }}
                          disabled={!canCreate}
                          title={canCreate ? 'Create a new secret from pasted or imported fields' : 'Your token cannot create secrets here'}
                        >
                          <Upload size={14} /> Import new secret…
                        </button>
                        <button onClick={() => void (async () => { await openEdit(); setDialog('export'); })} disabled={!service}>
                          <Download size={14} /> Export values…
                        </button>
                        <button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); openPromote(envs.find((name) => name !== env) ?? ''); }} disabled={!writable || envs.length < 2}>
                          <ArrowRightLeft size={14} /> Promote to…
                        </button>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      icon={<Plus size={15} />}
                      onClick={() => void openCreate()}
                      disabled={!canCreate}
                      title={canCreate ? 'Create a new folder (KV path)' : 'Your token cannot create folders here'}
                    >
                      New folder
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      icon={<Upload size={15} />}
                      onClick={openStandaloneImport}
                      disabled={!canCreate}
                      title={canCreate ? 'Create a new folder from pasted fields' : 'Your token cannot create secrets here'}
                    >
                      Import
                    </Button>
                  </>
                )}
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
                        <button className="link-btn mono" onClick={() => guardInline(() => { setFolder(crumb.path); setService(undefined); })}>{crumb.label}</button>
                      </span>
                    ))}
                    {service && <><ChevronRight size={13} /><span className="mono strong">{secretName(service)}</span></>}
                  </nav>
                )}
                {!service && <p className="muted">Pick a folder on the left, then choose a secret. <strong>New folder</strong> creates a new path; <strong>Import</strong> adds fields to a new secret.</p>}
                {service && secretQ.data && !writable && caps && <div className="notice warning small">{deniedReason(caps, currentPath, 'update')}</div>}
                {secretQ.isLoading && <div className="state"><div className="spinner" /></div>}
                {secretNotFound && (
                  <EmptyState icon={<KeyRound size={26} />} title="Secret not found">
                    This path does not exist in {env ?? 'this environment'}. It may have been deleted, or the link may be out of date.
                  </EmptyState>
                )}
                {secretQ.isError && !secretNotFound && <ErrorState error={secretQ.error} onRetry={() => void secretQ.refetch()} />}
                {secretQ.data && (
                  <>
                    {(annotations.tags.length > 0 || annotations.note) && (
                      <div className="annotation-strip">
                        {annotations.tags.map((tag) => <Badge key={tag} size="small" variant="outline"><Tag size={11} /> {tag}</Badge>)}
                        {annotations.note && <span className="small muted"><MessageSquareText size={12} /> {annotations.note}</span>}
                      </div>
                    )}
                    {fieldGroups.length === 0 && <EmptyState title="Empty secret">This secret has no fields yet. Use <strong>Add key</strong> above to add the first one.</EmptyState>}
                    {fieldGroups.map((group) => (
                      <details key={group.id} className="field-group" data-testid={`field-group-${group.id}`}>
                        <summary>
                          <span>{group.label}</span>
                          <Badge size="small">{group.fields.length}</Badge>
                        </summary>
                        <div className="field-group__fields">
                          {group.fields.map(([key, value]) => {
                            const refs = findReferences(String(value ?? ''));
                            const index = inlineOrder.indexOf(key);
                            return (
                              <SecretField
                                key={key}
                                name={key}
                                value={value}
                                comment={annotations.comments[key]}
                                override={Object.prototype.hasOwnProperty.call(myOverrides, key) ? myOverrides[key] : undefined}
                                resolved={refs.length > 0 ? resolveReferences(String(value ?? ''), referenceLookup) : undefined}
                                resetKey={resetKey}
                                editable={writable && version === undefined}
                                editing={inlineEditing === key}
                                draftValue={inlineDraft[key]}
                                removed={inlineDraft[key] === null}
                                nextField={inlineOrder[index + 1]}
                                onStartEdit={setInlineEditing}
                                onStage={stageInline}
                                onCancelEdit={() => setInlineEditing(null)}
                                onRemove={removeInline}
                                onUndoRemove={undoRemoveInline}
                              />
                            );
                          })}
                        </div>
                      </details>
                    ))}
                    {Object.entries(inlineDraft)
                      .filter(([key, value]) => value !== null && !Object.prototype.hasOwnProperty.call(inlineBase, key))
                      .map(([key, value]) => (
                        <SecretField
                          key={`staged-${key}`}
                          name={key}
                          value=""
                          staged
                          resetKey={resetKey}
                          editable={writable && version === undefined}
                          editing={inlineEditing === key}
                          draftValue={value}
                          onStartEdit={setInlineEditing}
                          onStage={stageInline}
                          onCancelEdit={() => setInlineEditing(null)}
                          onRemove={removeInline}
                          onUndoRemove={undoRemoveInline}
                        />
                      ))}
                    {inlineAddOpen && (
                      <div className="inline-add" data-testid="inline-add-row">
                        <input
                          className="mono"
                          aria-label="New key name"
                          placeholder="KEY"
                          autoFocus
                          value={inlineAddKey}
                          onChange={(event) => { setInlineAddKey(event.target.value); setInlineAddError(null); }}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addInlineField(); } }}
                        />
                        <input
                          className="mono"
                          aria-label="New key value"
                          placeholder="value"
                          autoComplete="off"
                          spellCheck={false}
                          value={inlineAddValue}
                          onChange={(event) => setInlineAddValue(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addInlineField(); } }}
                        />
                        <Button size="small" onClick={addInlineField}>Add</Button>
                        <Button size="small" variant="ghost" onClick={() => { setInlineAddOpen(false); setInlineAddError(null); }}>Cancel</Button>
                      </div>
                    )}
                    {inlineAddError && <p className="field__error" role="alert">{inlineAddError}</p>}
                    {inlineDirty && (
                      <div className="inline-change-bar" data-testid="inline-change-bar">
                        <span>
                          <strong>{inlineChanges.length} change{inlineChanges.length === 1 ? '' : 's'}</strong>
                          <span className="small muted"> · staged, not saved</span>
                        </span>
                        <div className="inline-change-bar__actions">
                          <Button size="small" variant="outlined" onClick={() => setInlineReview(true)} data-testid="inline-review">Review</Button>
                          <Button size="small" variant="ghost" onClick={discardInline} data-testid="inline-discard">Discard</Button>
                          <Button
                            size="small"
                            icon={<Lock size={14} />}
                            onClick={() => void saveInline()}
                            loading={savingInline}
                            disabled={savingInline}
                            data-testid="inline-save"
                            title="Save only the changed keys with kv patch"
                          >
                            Save changes
                          </Button>
                        </div>
                      </div>
                    )}
                    {inlineError && <div className="notice error small" role="alert">{inlineError}</div>}
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
                caps={caps}
              />
            )}

            {project && env && service && (
              <SecretSettingsPanel project={project} env={env} service={service} caps={caps} />
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
          testId="promote-dialog"
          onClose={closePromote}
          footer={
            <>
              <Button variant="outlined" onClick={closePromote}>Cancel</Button>
              <Button
                icon={<ArrowRightLeft size={15} />}
                data-testid="promote-confirm"
                onClick={() => void promote()}
                disabled={promotionNeedsAck && !promoteAck}
                title={promotionNeedsAck && !promoteAck ? 'Confirm the fields that will be removed first' : 'Write the source field set to the destination'}
              >
                Promote values
              </Button>
            </>
          }
        >
          <p className="small muted">
            This copies the {version !== undefined ? `v${version} ` : 'current '}field set from {env} into{' '}
            <span className="mono">{secretPath(project, promoteTo, service)}</span>. Field names are listed below; values stay masked.
          </p>
          <div className="field">
            <label htmlFor="promote-target">Destination environment</label>
            <select
              id="promote-target"
              data-testid="promote-target"
              value={promoteTo}
              onChange={(event) => openPromote(event.target.value)}
            >
              {envs.filter((name) => name !== env).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <TargetPreview
            preview={promotePreview}
            loading={promoteTargetQ.isLoading}
            missing={promoteTargetQ.isError}
            sourceCount={Object.keys(promoteSource).length}
          />
          {promotionNeedsAck && (
            <div className="notice error small" data-testid="promote-removal-warning">
              <strong>{promotePreview.removed.length} field{promotePreview.removed.length === 1 ? '' : 's'} will be deleted at the destination.</strong>{' '}
              Promotion writes the whole source field set, so destination-only fields cannot be kept.
            </div>
          )}
          {promotionNeedsAck && (
            <label className="check-row" data-testid="promote-ack">
              <input type="checkbox" checked={promoteAck} onChange={(event) => setPromoteAck(event.target.checked)} />
              I understand these fields will be removed
            </label>
          )}
          <div className="notice warning small">
            The destination is written with your current token. Your audit log records the write.
          </div>
        </Dialog>
      )}

      {inlineReview && (
        <Dialog
          title="Review staged changes"
          onClose={() => setInlineReview(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setInlineReview(false)}>Keep editing</Button>
              <Button icon={<Lock size={15} />} onClick={() => { setInlineReview(false); void saveInline(); }} loading={savingInline}>
                Save changes
              </Button>
            </>
          }
        >
          <p className="small muted">
            {inlineChanges.length} field{inlineChanges.length === 1 ? '' : 's'} will change. Values stay masked until you reveal them,
            and nothing is written until you save. Removals need a full write; everything else is one <code>kv patch</code>.
          </p>
          <div className="review-list" data-testid="inline-review-list">
            {inlineChanges.map(([key, value]) => {
              const kind = value === null ? 'remove' : Object.prototype.hasOwnProperty.call(inlineBase, key) ? 'update' : 'new';
              return (
                <div className="review-row" key={key} data-testid={`review-${key}`}>
                  <span className="mono strong">{key}</span>
                  <Badge size="small" variant={kind === 'remove' ? 'danger' : kind === 'new' ? 'success' : 'warning'}>
                    {kind === 'remove' ? 'removed' : kind}
                  </Badge>
                  {value === null
                    ? <span className="small muted">Key will be deleted</span>
                    : <ReviewValue value={value} />}
                </div>
              );
            })}
          </div>
        </Dialog>
      )}

      {pendingInlineNav && (
        <Dialog
          title="Discard unsaved changes?"
          onClose={() => setPendingInlineNav(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setPendingInlineNav(null)}>Keep editing</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const run = pendingInlineNav;
                  setPendingInlineNav(null);
                  discardInline();
                  run();
                }}
              >
                Discard and continue
              </Button>
            </>
          }
        >
          <p className="small muted">
            {inlineChanges.length} staged field change{inlineChanges.length === 1 ? '' : 's'} {inlineChanges.length === 1 ? 'has' : 'have'} not been written to OpenBao.
            Moving to another secret, folder or environment discards them.
          </p>
        </Dialog>
      )}

      {blocker.status === 'blocked' && (
        <Dialog
          title="Discard unsaved changes?"
          onClose={() => blocker.reset?.()}
          footer={
            <>
              <Button variant="outlined" onClick={() => blocker.reset?.()}>Keep editing</Button>
              <Button
                variant="danger"
                onClick={() => {
                  discardInline();
                  blocker.proceed?.();
                }}
              >
                Discard and continue
              </Button>
            </>
          }
        >
          <p className="small muted">
            {inlineChanges.length} staged field change{inlineChanges.length === 1 ? '' : 's'} will be lost.
            The project and environment controls change the page, so this also covers leaving it.
          </p>
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
              <span className="small muted" style={{ marginRight: 'auto' }} data-testid="editor-change-count">
                {editorChanges === 0 ? 'No changes' : `${editorChanges} change${editorChanges === 1 ? '' : 's'}`}
              </span>
              <Button variant="outlined" onClick={() => {
                if (editorBaseline && editorSnapshot(editor) !== editorBaseline) setConfirmDiscard(true);
                else setEditor(null);
              }} disabled={saving}>Discard</Button>
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
                <Button size="small" variant="ghost" icon={<Upload size={14} />} onClick={openDraftImport}>Import into draft</Button>
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
              : metadataQ.data?.data.cas_required
                ? 'This key requires check-and-set: the save uses the current version and reports a conflict if another write lands first.'
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

      {dialog === 'import' && (editor || importStandalone) && (
        <Dialog
          title={importStandalone ? 'Import a new secret' : 'Import into this draft'}
          testId="import-dialog"
          onClose={() => { setDialog(null); setImportStandalone(false); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => { setDialog(null); setImportStandalone(false); }}>Cancel</Button>
              <Button icon={<Upload size={15} />} data-testid="import-apply" onClick={applyImport}>
                {importStandalone ? 'Review fields' : 'Import'}
              </Button>
            </>
          }
        >
          {importStandalone && (
            <>
              <p className="small muted">
                Create a new secret from pasted or uploaded fields. Nothing is written yet — you review and save the draft.
              </p>
              <div className="field">
                <label htmlFor="import-target">New secret path (relative to this environment)</label>
                <input
                  id="import-target"
                  className="mono"
                  data-testid="import-target"
                  autoFocus
                  placeholder="e.g. database/postgres"
                  value={importTarget}
                  onChange={(event) => { setImportTarget(event.target.value); setImportError(null); }}
                />
                <p className="small muted">
                  Stored at <span className="mono">kv/data/{project && env ? secretApiPath(project, env, importTarget || '<path>') : '<path>'}</span>
                </p>
              </div>
            </>
          )}
          <div className="field-grid">
            <div className="field">
              <label htmlFor="import-format">Format</label>
              <select id="import-format" data-testid="import-format" value={importFormat} onChange={(event) => setImportFormat(event.target.value as ImportFormat)}>
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
          {!importStandalone && (
            <div className="check-row">
              <input type="checkbox" checked={importMode === 'replace'} onChange={(event) => setImportMode(event.target.checked ? 'replace' : 'merge')} />
              Replace all staged fields (otherwise imported names merge into the table)
            </div>
          )}
          <div className="field">
            <label htmlFor="import-text">Paste content</label>
            <textarea
              id="import-text"
              className="mono"
              data-testid="import-text"
              rows={9}
              value={importText}
              placeholder={importFormat === 'json' ? '{"KEY": "value"}' : 'KEY=value'}
              onChange={(event) => { setImportText(event.target.value); setImportError(null); }}
            />
          </div>
          {importError && <div className="notice error small" role="alert" data-testid="import-error">{importError}</div>}
          {!importError && importText.trim() && (() => {
            const parsed = parseKeyValueText(importText, importFormat);
            return (
              <div data-testid="import-detected">
                <p className="small muted">{Object.keys(parsed.data).length} fields detected.</p>
                <div className="method-chips">
                  {Object.keys(parsed.data).map((name) => <span className="method-chip" key={name}><code>{name}</code></span>)}
                </div>
              </div>
            );
          })()}
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
