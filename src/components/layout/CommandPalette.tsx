import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Activity, ArrowRight, Clock3, Compass, CornerDownLeft, Database, Folder,
  Globe2, KeyRound, Layers, Plus, Search, Shield, Star, Trash2,
} from 'lucide-react';
import { folderOf, isFavorite, loadRecent, toggleFavorite, type SecretRef } from '@/lib/navigationMemory';
import { normalizeSearch, searchTokens } from '@/lib/searchMatch';
import { searchIndex, type IndexHit } from '@/lib/searchIndex';
import { useSearchIndexStatus } from '@/lib/useSearchIndex';
import { useFavorites } from '@/lib/useFavorites';

type Scope = 'folder' | 'project' | 'all';
type GroupId = 'local' | 'other' | 'commands' | 'recent' | 'favorites';

interface Row {
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  run: () => void;
  favorite?: Omit<SecretRef, 'visitedAt'>;
  field?: string;
}
interface Group {
  id: GroupId;
  title: string;
  rows: Row[];
  indexing?: boolean;
}

const PAGE_SIZE = 5;

/** Highlight every query token without changing the original casing. */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = searchTokens(query);
  if (!tokens.length) return <>{text}</>;
  const normalized = normalizeSearch(text);
  const flags = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let from = 0;
    while (from < normalized.length) {
      const at = normalized.indexOf(token, from);
      if (at === -1) break;
      for (let i = at; i < Math.min(at + token.length, flags.length); i += 1) flags[i] = true;
      from = at + token.length;
    }
  }
  const parts: Array<{ text: string; mark: boolean }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = parts[parts.length - 1];
    if (last && last.mark === flags[i]) last.text += text[i];
    else parts.push({ text: text[i], mark: flags[i] });
  }
  return <>{parts.map((part, index) => part.mark
    ? <mark className="palette__mark" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const locationSearch = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [requestedScope, setRequestedScope] = useState<Scope | null>(null);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Set<GroupId>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useSearchIndexStatus();
  const favorites = useFavorites();

  const project = locationSearch.project ?? '';
  const env = locationSearch.env ?? '';
  const folder = locationSearch.folder ?? '';
  const onSecrets = pathname === '/secrets' || pathname === '/';
  const defaultScope: Scope = onSecrets && folder ? 'folder' : 'all';
  const usableScopes: Scope[] = [
    ...(onSecrets && folder ? ['folder' as const] : []),
    ...(project ? ['project' as const] : []),
    'all',
  ];

  const close = () => { setOpen(false); setRequestedScope(null); };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setRequestedScope(null);
        setOpen((value) => !value);
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    const opener = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: Scope }>).detail;
      setRequestedScope(detail?.scope ?? null);
      setOpen(true);
    };
    window.addEventListener('console:open-palette', opener);
    return () => window.removeEventListener('console:open-palette', opener);
  }, []);

  useEffect(() => {
    if (!open) return;
    const cycle = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const current = usableScopes.indexOf(scope);
      const step = event.shiftKey ? -1 : 1;
      setScope(usableScopes[(current + step + usableScopes.length) % usableScopes.length]);
    };
    window.addEventListener('keydown', cycle, true);
    return () => window.removeEventListener('keydown', cycle, true);
  }, [open, scope, usableScopes.join('|')]);

  useEffect(() => {
    if (!open) return;
    setScope(requestedScope && usableScopes.includes(requestedScope) ? requestedScope : defaultScope);
    setQuery('');
    setSelected(0);
    setExpanded(new Set());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]); // scope is intentionally chosen once per open

  const goToSecret = (hit: IndexHit) => {
    void navigate({
      to: '/secrets',
      search: {
        project: hit.entry.project,
        env: hit.entry.env,
        service: hit.entry.path,
        folder: folderOf(hit.entry.path) || undefined,
        field: hit.field,
      },
    });
  };

  const groups = useMemo<Group[]>(() => {
    const trimmed = query.trim();
    const navigateTo = (to: string, search: Record<string, string | undefined>) => () => { close(); void navigate({ to, search }); };

    if (!trimmed) {
      const recentRows: Row[] = loadRecent().map((ref) => ({
        id: `recent-${ref.project}-${ref.env}-${ref.path}-${ref.key ?? ''}`,
        label: `${ref.project} / ${ref.env} / ${ref.path}${ref.key ? ` › ${ref.key}` : ''}`,
        icon: <Clock3 size={15} />,
        run: navigateTo('/secrets', { project: ref.project, env: ref.env, service: ref.path, folder: folderOf(ref.path) || undefined, field: ref.key }),
        favorite: { project: ref.project, env: ref.env, path: ref.path, key: ref.key },
      }));
      const favoriteRows: Row[] = favorites.map((ref) => ({
        id: `fav-${ref.project}-${ref.env}-${ref.path}-${ref.key ?? ''}`,
        label: `${ref.project} / ${ref.env} / ${ref.path}${ref.key ? ` › ${ref.key}` : ''}`,
        icon: <Star size={15} />,
        run: navigateTo('/secrets', { project: ref.project, env: ref.env, service: ref.path, folder: folderOf(ref.path) || undefined, field: ref.key }),
        favorite: { project: ref.project, env: ref.env, path: ref.path, key: ref.key },
      }));
      return [
        { id: 'recent', title: 'Recent', rows: recentRows },
        { id: 'favorites', title: 'Favorites', rows: favoriteRows },
      ];
    }

    const scopeParams = scope === 'folder'
      ? { project, env, folder }
      : scope === 'project' ? { project } : (project ? { project } : {});
    const toRow = (hit: IndexHit): Row => ({
      id: `${hit.entry.project}-${hit.entry.env}-${hit.entry.path}-${hit.field ?? ''}`,
      label: hit.field ? `${hit.entry.path} › ${hit.field}` : hit.entry.path,
      meta: hit.field ? `${hit.entry.project} / ${hit.entry.env}` : undefined,
      icon: hit.field ? <Database size={15} /> : <KeyRound size={15} />,
      field: hit.field,
      favorite: { project: hit.entry.project, env: hit.entry.env, path: hit.entry.path, key: hit.field },
      run: () => { close(); goToSecret(hit); },
    });
    const local = searchIndex.search(trimmed, scopeParams).map(toRow);
    const other = searchIndex.search(trimmed, {}).filter((hit) => hit.entry.project !== project).map(toRow);

    const createRow: Row = {
      id: 'create-secret',
      label: `Create secret “${trimmed}” in ${folder || 'root'}`,
      icon: <Plus size={15} />,
      run: navigateTo('/secrets', { project: project || undefined, env: env || undefined, folder: folder || undefined, create: trimmed }),
    };
    const routes: Array<{ label: string; to: string; search: Record<string, string | undefined>; icon: ReactNode }> = [
      { label: 'Getting started', to: '/welcome', search: {}, icon: <Compass size={15} /> },
      { label: 'Secrets', to: '/secrets', search: {}, icon: <KeyRound size={15} /> },
      { label: 'Trash', to: '/trash', search: {}, icon: <Trash2 size={15} /> },
      { label: 'Access control', to: '/access', search: {}, icon: <Shield size={15} /> },
      { label: 'Audit log', to: '/audit', search: {}, icon: <Activity size={15} /> },
    ];
    const navRows: Row[] = routes
      .filter((route) => matchesLabel(route.label, trimmed))
      .map((route) => ({
        id: `go-${route.to}`,
        label: route.label,
        icon: route.icon,
        run: navigateTo(route.to, route.search),
      }));

    return [
      {
        id: 'local',
        title: `In ${project || 'this project'} / ${env || 'this environment'} / ${folder || 'root'}`,
        rows: local,
      },
      {
        id: 'other',
        title: 'Other projects',
        rows: other,
        indexing: status.state === 'building',
      },
      { id: 'commands', title: 'Commands', rows: [createRow, ...navRows] },
    ];
  }, [query, scope, project, env, folder, favorites, status.state, navigate]);

  function matchesLabel(label: string, value: string): boolean {
    const tokens = searchTokens(value);
    const target = normalizeSearch(label);
    return tokens.every((token) => target.includes(token));
  }

  const visibleGroups = groups.map((group) => {
    const isExpanded = expanded.has(group.id);
    return { ...group, rows: isExpanded ? group.rows : group.rows.slice(0, PAGE_SIZE) };
  });
  const rows = visibleGroups.flatMap((group) => group.rows);

  function run(row: Row) { row.run(); setOpen(false); }
  function toggleStar(event: React.MouseEvent, ref: Omit<SecretRef, 'visitedAt'>) {
    event.stopPropagation();
    toggleFavorite(ref);
  }

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette">
        <div className="palette__input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Command or search"
            placeholder="Jump to a secret, search, or run a command…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0); setExpanded(new Set()); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, rows.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
              if (event.key === 'Enter' && rows[selected]) { event.preventDefault(); run(rows[selected]); }
            }}
          />
          <kbd className="palette__esc" aria-hidden="true">esc</kbd>
        </div>
        <div className="palette__scopes" role="group" aria-label="Search scope" data-testid="palette-scopes">
          <button
            type="button" data-testid="scope-folder" aria-pressed={scope === 'folder'}
            disabled={!usableScopes.includes('folder')}
            onClick={() => setScope('folder')}
          ><Folder size={12} /> This folder</button>
          <button
            type="button" data-testid="scope-project" aria-pressed={scope === 'project'}
            disabled={!usableScopes.includes('project')}
            onClick={() => setScope('project')}
          ><Layers size={12} /> {project || 'This project'}</button>
          <button
            type="button" data-testid="scope-all" aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
          ><Globe2 size={12} /> Everywhere</button>
          <span className="palette__scope-hint">Tab to change scope</span>
        </div>
        <ul className="palette__list" role="listbox" aria-label="Search results" data-testid="palette-results">
          {visibleGroups.map((group) => {
            const original = groups.find((item) => item.id === group.id)!;
            return (
              <li className="palette__group-wrap" key={group.id} data-testid={`palette-group-${group.id}`}>
                <div className="palette__heading">
                  {group.title}
                  {group.indexing && <span className="palette__indexing">Indexing… {status.done} / {status.total}</span>}
                </div>
                <ul>
                  {group.rows.map((row) => {
                    const index = rows.indexOf(row);
                    return (
                      <li key={row.id} role="option" aria-selected={index === selected}>
                        <div className={`palette__item ${index === selected ? 'selected' : ''}`}>
                          <button
                            className="palette__item-main"
                            onMouseEnter={() => setSelected(index)}
                            onClick={() => run(row)}
                            data-testid={`palette-${group.id}-row`}
                          >
                            {row.icon}
                            <span><Highlight text={row.label} query={query} /></span>
                            {row.meta && <span className="palette__meta">{row.meta}</span>}
                            {index === selected && <CornerDownLeft size={13} />}
                          </button>
                          {row.favorite && (
                            <button
                              className={`palette__star ${isFavorite(row.favorite, favorites) ? 'starred' : ''}`}
                              aria-label={isFavorite(row.favorite, favorites) ? 'Unfavorite' : 'Favorite'}
                              title={isFavorite(row.favorite, favorites) ? 'Remove favorite' : 'Pin to favorites'}
                              onClick={(event) => toggleStar(event, row.favorite!)}
                              data-testid="palette-star"
                            >
                              <Star size={14} fill={isFavorite(row.favorite, favorites) ? 'currentColor' : 'none'} />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {original.rows.length > PAGE_SIZE && (
                    <li>
                      <button
                        className="palette__more"
                        onClick={() => setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                          return next;
                        })}
                        data-testid={`palette-more-${group.id}`}
                      >
                        <ArrowRight size={13} /> {expanded.has(group.id) ? 'Show fewer' : `See all ${original.rows.length} results`}
                      </button>
                    </li>
                  )}
                  {group.rows.length === 0 && group.id === 'local' && status.state === 'building' && (
                    <li className="palette__empty">Indexing… {status.done} / {status.total}</li>
                  )}
                </ul>
              </li>
            );
          })}
          {rows.length === 0 && status.state !== 'building' && <li className="palette__empty">No matches yet.</li>}
        </ul>
        <div className="palette__foot"><ArrowRight size={12} /> Up/down to move · Enter to open · Tab for scope · Esc to close</div>
      </div>
    </div>
  );
}
