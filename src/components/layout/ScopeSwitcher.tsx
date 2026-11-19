import { useMemo, useRef, type MouseEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronDown, FolderKanban, Layers } from 'lucide-react';
import { envRank } from '@/lib/baoPaths';
import { useEnvironments, useLayoutDiscovery, useProjects } from '@/lib/queries';

/**
 * Project and environment scope for the Secrets page, shown in the global
 * topbar where the page title used to be. The URL stays the source of truth:
 * every change is a navigation, so deep links, back/forward and the unsaved
 * changes guard all keep working.
 */
export function ScopeSwitcher() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const isSecrets = pathname === '/secrets' || pathname === '/';
  const projectRef = useRef<HTMLSelectElement>(null);
  const envRef = useRef<HTMLSelectElement>(null);

  const projects = useProjects();
  const project = search.project ?? projects.data?.[0];
  const environments = useEnvironments(isSecrets ? project : undefined);
  const discovery = useLayoutDiscovery(isSecrets ? project : undefined);
  const envs = useMemo(() => [...(environments.data ?? [])].sort(envRank), [environments.data]);
  const env = search.env ?? envs[0];
  const loading = Boolean(project) && (discovery.isLoading || environments.isLoading);

  if (!isSecrets) return null;

  function changeProject(next: string) {
    if (!next) return;
    void navigate({
      to: '/secrets',
      search: { project: next, env: undefined, service: undefined, folder: undefined },
    });
  }

  function changeEnv(next: string) {
    if (!next) return;
    void navigate({
      to: '/secrets',
      search: { project, env: next, service: undefined, folder: search.folder },
    });
  }

  // A click anywhere in the chip should open its select, not just a click on
  // the narrow native control. Clicks on the select itself keep native behaviour.
  function openPicker(select: HTMLSelectElement | null, event: MouseEvent<HTMLLabelElement>) {
    if (!select || select.disabled || event.target === select) return;
    event.preventDefault();
    select.focus();
    const picker = (select as HTMLSelectElement & { showPicker?: () => void }).showPicker;
    try {
      if (picker) picker.call(select);
      else select.click();
    } catch {
      // showPicker is unavailable in some browsers; focus is still useful.
    }
  }

  return (
    <div className="scope-switcher" data-testid="scope-switcher">
      <label className="scope-select" title="Switch project" onClick={(event) => openPicker(projectRef.current, event)}>
        <FolderKanban size={15} aria-hidden="true" />
        <span className="scope-select__label">Project</span>
        <select
          ref={projectRef}
          aria-label="Project"
          data-testid="scope-project"
          value={project ?? ''}
          disabled={projects.isLoading}
          onChange={(event) => changeProject(event.target.value)}
        >
          {projects.isLoading && <option value="">Loading…</option>}
          {projects.data?.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <ChevronDown size={14} className="scope-select__chevron" aria-hidden="true" />
      </label>

      <label className="scope-select" title={loading ? 'Discovering environments…' : 'Switch environment'} onClick={(event) => openPicker(envRef.current, event)}>
        <Layers size={15} aria-hidden="true" />
        <span className="scope-select__label">Environment</span>
        <select
          ref={envRef}
          aria-label="Environment"
          data-testid="scope-environment"
          value={env ?? ''}
          disabled={loading || envs.length === 0}
          onChange={(event) => changeEnv(event.target.value)}
        >
          {loading
            ? <option value="">Loading…</option>
            : envs.length === 0
              ? <option value="">No environment</option>
              : envs.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <ChevronDown size={14} className="scope-select__chevron" aria-hidden="true" />
      </label>
    </div>
  );
}
