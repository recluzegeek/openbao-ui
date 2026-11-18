import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { BookOpen, Database, ExternalLink, Link2, ListOrdered, RefreshCw, User } from 'lucide-react';
import { can, deniedReason } from '@/lib/capabilities';
import { runbookApiPath } from '@/lib/baoPaths';
import { useCapabilities, useRunbook, useRunbookProjects, runbookCapabilityPaths } from '@/lib/queries';
import { formatWhen } from '@/lib/format';
import { useClipboard } from '@/lib/useClipboard';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CopyButton, EmptyState, ErrorState } from '@/components/common/Extras';

type Search = Record<string, string | undefined>;

interface RunbookLink { label: string; url: string }
interface RunbookSecret { project: string; env: string; service: string; label?: string }

interface NormalizedRunbook {
  title: string;
  summary: string;
  owner: string;
  rotation: string;
  steps: string[];
  links: RunbookLink[];
  secrets: RunbookSecret[];
  updated: string;
  version?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRunbook(data: Record<string, unknown>, metadata?: { created_time?: string; version?: number }): NormalizedRunbook {
  const rawSteps = data.steps;
  const steps = Array.isArray(rawSteps)
    ? rawSteps.map(text).filter(Boolean)
    : text(rawSteps).split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const links = (Array.isArray(data.links) ? data.links : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({ label: text(item.label) || text(item.url), url: text(item.url) }))
    .filter((item) => item.url.length > 0);

  const secrets = (Array.isArray(data.secrets) ? data.secrets : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      project: text(item.project),
      env: text(item.env),
      service: text(item.service),
      label: text(item.label),
    }))
    .filter((item) => item.project && item.env && item.service);

  return {
    title: text(data.title),
    summary: text(data.summary),
    owner: text(data.owner),
    rotation: text(data.rotation),
    steps,
    links,
    secrets,
    updated: metadata?.created_time ?? '',
    version: metadata?.version,
  };
}

export function RunbooksPage() {
  const navigate = useNavigate({ from: '/runbooks' });
  const search = useRouterState({ select: (state) => state.location.search }) as Search;
  const [selected, setSelected] = useState<string | undefined>(search.project);
  const copy = useClipboard();

  const projectsQ = useRunbookProjects();
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const capsQ = useCapabilities(runbookCapabilityPaths(projects));
  const caps = capsQ.data;
  const canList = can(caps, 'kv/metadata/_runbooks/', 'list');
  const readPath = selected ? runbookApiPath(selected) : '';
  const canRead = can(caps, readPath, 'read');
  const runbookQ = useRunbook(selected);

  useEffect(() => {
    if (!selected && projects.length) setSelected(search.project && projects.includes(search.project) ? search.project : projects[0]);
  }, [projects, selected, search.project]);

  useEffect(() => {
    if (selected) void navigate({ to: '/runbooks', search: { project: selected }, replace: true });
  }, [selected, navigate]);

  const book = runbookQ.data
    ? normalizeRunbook(runbookQ.data.data.data, runbookQ.data.data.metadata)
    : null;
  const stepsText = book?.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') ?? '';

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <div className="page__header">
        <div>
          <p>Operational notes stored next to the secrets they describe. Open a runbook to see the steps and jump to its related secrets.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {selected && <Button variant="outlined" size="small" icon={<Database size={15} />} onClick={() => void navigate({ to: '/secrets', search: { project: selected, env: undefined, service: undefined, folder: undefined } })}>
            Browse {selected} secrets
          </Button>}
        </div>
      </div>

      <div className="grid grid--split">
        <div className="panel">
          <div className="panel__head">
            <BookOpen size={17} />
            <h3>Projects</h3>
            <Badge size="small">{projects.length}</Badge>
          </div>
          {projectsQ.isLoading && <div className="state"><div className="spinner" /></div>}
          {projectsQ.isError && !canList && caps && (
            <div className="notice warning small" style={{ margin: 'var(--spacing-md)' }}>
              {deniedReason(caps, 'kv/metadata/_runbooks/', 'list')}
            </div>
          )}
          {projectsQ.isError && canList && <ErrorState error={projectsQ.error} />}
          {!projectsQ.isLoading && projects.length === 0 && !projectsQ.isError && (
            <EmptyState icon={<BookOpen size={26} />} title="No runbooks">Add a secret under <code>_runbooks/&lt;project&gt;</code> to document it here.</EmptyState>
          )}
          {projects.map((project) => (
            <button key={project} className={`list-item ${selected === project ? 'selected' : ''}`} onClick={() => setSelected(project)}>
              <BookOpen size={16} />
              <span className="list-item__main">
                <span className="list-item__title">{project}</span>
                <span className="list-item__sub">{runbookApiPath(project)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <div className="panel__head">
              <ListOrdered size={17} />
              <h3>{book?.title || selected || 'Select a runbook'}</h3>
              {book?.version !== undefined && <Badge variant="info" size="small">v{book.version}</Badge>}
            </div>
            <div className="panel__body">
              {!selected && <p className="muted">Choose a runbook on the left to read its steps.</p>}
              {selected && !canRead && caps && <div className="notice warning small">{deniedReason(caps, readPath, 'read')}</div>}
              {canRead && runbookQ.isLoading && <div className="state"><div className="spinner" /></div>}
              {canRead && runbookQ.isError && <ErrorState error={runbookQ.error} onRetry={() => void runbookQ.refetch()} />}
              {book && (
                <>
                  {book.summary && <p className="muted">{book.summary}</p>}
                  <div className="meta-row">
                    {book.owner && <span><User size={12} /> {book.owner}</span>}
                    {book.rotation && <span><RefreshCw size={12} /> {book.rotation}</span>}
                    {book.updated && <span>Updated {formatWhen(book.updated)}</span>}
                  </div>
                  <div className="divider" />
                  {book.steps.length === 0 ? (
                    <EmptyState title="No steps yet">This runbook has no <code>steps</code> field.</EmptyState>
                  ) : (
                    <ol className="runbook-steps">
                      {book.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                    </ol>
                  )}
                  {stepsText && (
                    <Button size="small" variant="outlined" icon={<Link2 size={14} />} onClick={() => void copy(stepsText, 'Runbook steps copied')}>
                      Copy steps
                    </Button>
                  )}
                  {book.secrets.length > 0 && (
                    <>
                      <div className="divider" />
                      <div className="section-title">Related secrets</div>
                      <div className="runbook-links">
                        {book.secrets.map((secret) => (
                          <Link
                            key={`${secret.project}-${secret.env}-${secret.service}`}
                            to="/secrets"
                            search={{ project: secret.project, env: secret.env, service: secret.service, folder: undefined }}
                            className="runbook-link"
                          >
                            <Database size={14} />
                            <span>{secret.label || `${secret.service} · ${secret.env}`}</span>
                            <ExternalLink size={13} />
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                  {book.links.length > 0 && (
                    <>
                      <div className="divider" />
                      <div className="section-title">Links</div>
                      <div className="runbook-links">
                        {book.links.map((link) => (
                          <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="runbook-link">
                            <Link2 size={14} />
                            <span>{link.label}</span>
                            <ExternalLink size={13} />
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="divider" />
                  <div className="row-actions">
                    <code className="small muted">{selected ? runbookApiPath(selected) : ''}</code>
                    <CopyButton value={selected ? runbookApiPath(selected) : ''} label="Copy runbook path" />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
