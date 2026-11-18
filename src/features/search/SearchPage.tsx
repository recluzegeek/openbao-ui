import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import { Clock3, Database, Search, Star } from 'lucide-react';
import { bao } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { formatWhen } from '@/lib/format';
import { folderOf, isFavorite, loadFavorites, loadRecent, toggleFavorite, type SecretRef } from '@/lib/navigationMemory';
import { fetchLayoutDiscovery, useProjects } from '@/lib/queries';
import { Badge } from '@/components/common/Badge';
import { EmptyState, EnvBadge } from '@/components/common/Extras';

interface Hit extends Omit<SecretRef, 'visitedAt'> {
  title: string;
  detail: string;
}

const MAX_SECRETS = 80;

export function SearchPage() {
  const navigate = useNavigate({ from: '/search' });
  const search = useRouterState({ select: (state) => state.location.search }) as { q?: string };
  const [input, setInput] = useState(search.q ?? '');
  const projects = useProjects();

  useEffect(() => setInput(search.q ?? ''), [search.q]);

  // Use the same discovery/resolver as the Secrets page. Probing `<project>/env/`
  // directly produced 22 404s and indexed only one layout on this server.
  const discoveryQueries = useQueries({
    queries: (projects.data ?? []).map((project) => ({
      queryKey: ['layout-discovery', project],
      queryFn: () => fetchLayoutDiscovery(project),
      retry: false,
      staleTime: 120_000,
    })),
  });
  const pairs = (projects.data ?? []).flatMap((project, index) => {
    const seen = new Set<string>();
    return (discoveryQueries[index]?.data?.classified ?? []).flatMap((secret) => {
      const key = `${secret.env}\0${secret.logical}`;
      if (!secret.logical || seen.has(key)) return [];
      seen.add(key);
      return [{ project, env: secret.env, path: secret.logical }];
    });
  });
  const targets = pairs.slice(0, MAX_SECRETS);
  const secretQueries = useQueries({
    queries: targets.map(({ project, env, path }) => ({
      queryKey: ['secret', project, env, path, 'search'],
      queryFn: () => bao.readSecret(secretApiPath(project, env, path)),
      retry: false,
      staleTime: 30_000,
    })),
  });

  const [favorites, setFavorites] = useState<SecretRef[]>(() => loadFavorites());
  // Recents can outlive a project (test projects get removed). Drop entries
  // whose project no longer exists instead of offering a dead link.
  const projectNames = useMemo(() => new Set(projects.data ?? []), [projects.data]);
  const recent = useMemo(
    () => loadRecent().filter((ref) => !projects.data || projectNames.has(ref.project)),
    [input, projects.data, projectNames],
  );
  const allHits = useMemo<Hit[]>(() => targets.flatMap((target, index) => {
    const fields = Object.keys(secretQueries[index]?.data?.data.data ?? {});
    const self: Hit = { ...target, title: target.path, detail: `${fields.length} fields` };
    const fieldHits: Hit[] = fields.map((key) => ({ ...target, key, title: key, detail: `${target.project}/${target.env}/${target.path}` }));
    return [self, ...fieldHits];
  }), [targets.map((target) => `${target.project}/${target.env}/${target.path}`).join('|'), secretQueries]);

  const query = input.trim().toLowerCase();
  const results = query
    ? allHits.filter((hit) => [hit.title, hit.project, hit.env, hit.path, hit.key ?? ''].join(' ').toLowerCase().includes(query)).slice(0, 60)
    : allHits.filter((hit) => !hit.key).slice(0, 20);
  const isLoading = projects.isLoading
    || discoveryQueries.some((q) => q.isLoading)
    || secretQueries.some((q) => q.isLoading);

  function onFavorite(hit: Omit<SecretRef, 'visitedAt'>) {
    setFavorites(toggleFavorite({
      project: hit.project,
      env: hit.env,
      path: hit.path,
      ...(hit.key ? { key: hit.key } : {}),
    }));
  }

  function renderHit(hit: Hit, showToggle = true) {
    const starred = isFavorite(hit, favorites);
    return (
      <div className="search-result" key={`${hit.project}/${hit.env}/${hit.path}/${hit.key ?? ''}`} data-testid={`search-hit-${hit.key ?? hit.path}`}>
        <Link
          to="/secrets"
          search={{ project: hit.project, env: hit.env, service: hit.path, folder: folderOf(hit.path) || undefined }}
          className="search-result__link"
        >
          {hit.key ? <Database size={14} /> : <Search size={14} />}
          <span className="search-result__main">
            <span className="mono strong">{hit.title}</span>
            <span className="small muted mono">{hit.detail}</span>
          </span>
          <EnvBadge env={hit.env} />
          <span className="small muted mono">{hit.project}</span>
        </Link>
        {showToggle && (
          <button
            className={`icon-btn ${starred ? 'starred' : ''}`}
            onClick={() => onFavorite(hit)}
            aria-label={starred ? `Unfavorite ${hit.title}` : `Favorite ${hit.title}`}
            title={starred ? 'Remove favorite' : 'Add favorite'}
          >
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="page__header">
        <div>
          <p>Find a secret or field by name across every project and environment you can read.</p>
        </div>
      </div>

      <div className="search search--large">
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Search secrets and fields"
          data-testid="global-search-input"
          placeholder="Try HOST, postgres, or ui-demo…"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            void navigate({ search: { q: event.target.value || undefined }, replace: true });
          }}
        />
      </div>

      {isLoading && <div className="state" data-testid="search-loading"><div className="spinner" /><p>Indexing readable secrets…</p></div>}

      {query && (
        <div className="panel" data-testid="search-results">
          <div className="panel__head"><Search size={17} /><h3>Results</h3><Badge size="small">{results.length}</Badge></div>
          <div className="panel__body">
            {results.length === 0 && !isLoading && <EmptyState title="No matches">Try a field name, a folder, or a project name.</EmptyState>}
            {results.map((hit) => renderHit(hit))}
          </div>
        </div>
      )}

      {!query && (
        <>
          <div className="panel">
            <div className="panel__head"><Clock3 size={17} /><h3>Recent secrets</h3></div>
            <div className="panel__body">
              {recent.length === 0 && <p className="muted">Open a secret to see it here. Only paths are remembered.</p>}
              {recent.map((ref) => renderHit({ ...ref, title: ref.path, detail: ref.key ? `field ${ref.key}` : `visited ${formatWhen(new Date(ref.visitedAt).toISOString())}` }))}
            </div>
          </div>
          <div className="panel">
            <div className="panel__head"><Star size={17} /><h3>Favorites</h3><Badge size="small">{favorites.length}</Badge></div>
            <div className="panel__body">
              {favorites.length === 0 && <p className="muted">Star a result to pin it here for this browser.</p>}
              {favorites.map((ref) => renderHit({ ...ref, title: ref.path, detail: ref.key ? `field ${ref.key}` : `${ref.project}/${ref.env}` }))}
            </div>
          </div>
          <div className="panel">
            <div className="panel__head"><Database size={17} /><h3>Browse readable secrets</h3></div>
            <div className="panel__body">
              {results.length === 0 && !isLoading && <p className="muted">No secrets are readable with this token.</p>}
              {results.map((hit) => renderHit(hit))}
            </div>
          </div>
        </>
      )}

      <p className="small muted" data-testid="search-index-note">
        Field names require a temporary KV read of each secret; values are not displayed, logged or persisted.
        {targets.length >= MAX_SECRETS && ` Showing the first ${MAX_SECRETS} secrets.`}
      </p>
    </div>
  );
}
