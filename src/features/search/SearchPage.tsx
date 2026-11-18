import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Database, RefreshCw, Search, Star } from 'lucide-react';
import { formatWhen } from '@/lib/format';
import { folderOf, isFavorite, loadFavorites, loadRecent, toggleFavorite, type SecretRef } from '@/lib/navigationMemory';
import { useProjects } from '@/lib/queries';
import { buildSearchIndex, type IndexedSecret } from '@/lib/searchIndex';
import { matchesSearch, uniqueBy } from '@/lib/searchMatch';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { EmptyState, EnvBadge, ErrorState } from '@/components/common/Extras';

interface Hit extends Omit<SecretRef, 'visitedAt'> {
  title: string;
  detail: string;
}

const INDEX_STALE_MS = 5 * 60_000;

export function SearchPage() {
  const navigate = useNavigate({ from: '/search' });
  const search = useRouterState({ select: (state) => state.location.search }) as { q?: string };
  const [input, setInput] = useState(search.q ?? '');
  const projects = useProjects();

  useEffect(() => setInput(search.q ?? ''), [search.q]);

  // Paths and field names are cached for five minutes. The refresh button asks
  // the index to revalidate; unchanged secrets are skipped via KV metadata.
  const index = useQuery({
    queryKey: ['search-index', (projects.data ?? []).join('\0')],
    queryFn: () => buildSearchIndex(projects.data ?? []),
    enabled: Boolean(projects.data?.length),
    staleTime: INDEX_STALE_MS,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const indexed = useMemo(() => index.data?.secrets ?? [], [index.data]);

  const [favorites, setFavorites] = useState<SecretRef[]>(() => loadFavorites());
  // Recents can outlive a project (test projects get removed). Drop entries
  // whose project no longer exists instead of offering a dead link.
  const projectNames = useMemo(() => new Set(projects.data ?? []), [projects.data]);
  const recent = useMemo(
    () => loadRecent().filter((ref) => !projects.data || projectNames.has(ref.project)),
    [input, projects.data, projectNames],
  );

  const allHits = useMemo<Hit[]>(() => indexed.flatMap((target: IndexedSecret) => {
    const self: Hit = { ...target, title: target.path, detail: `${target.fields.length} fields` };
    const fieldHits: Hit[] = target.fields.map((key) => ({
      ...target,
      key,
      title: key,
      detail: `${target.project}/${target.env}/${target.path}`,
    }));
    return [self, ...fieldHits];
  }), [indexed]);

  const query = input.trim();
  const results = query
    ? allHits
      .filter((hit) => matchesSearch([hit.title, hit.project, hit.env, hit.path, hit.key], query))
      .slice(0, 60)
    : allHits.filter((hit) => !hit.key).slice(0, 20);
  const isLoading = projects.isLoading || index.isLoading;
  const isRefreshing = index.isFetching && !index.isLoading;

  // A favorite/recents row and an index row can describe the same secret.
  const uniqueRecent = useMemo(
    () => uniqueBy(recent, (ref) => `${ref.project}/${ref.env}/${ref.path}/${ref.key ?? ''}`),
    [recent],
  );

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
        <div className="topbar__actions">
          <Button
            size="small"
            variant="outlined"
            data-testid="search-refresh"
            icon={<RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />}
            onClick={() => void index.refetch()}
            disabled={isRefreshing || !projects.data?.length}
            title="Revalidate paths and field names. Unchanged secrets are not re-read."
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh index'}
          </Button>
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
      {index.isError && <ErrorState error={index.error} onRetry={() => void index.refetch()} />}

      {query && !isLoading && (
        <div className="panel" data-testid="search-results">
          <div className="panel__head">
            <Search size={17} />
            <h3>Results</h3>
            <Badge size="small">{results.length}</Badge>
            {isRefreshing && <span className="small muted">refreshing…</span>}
          </div>
          <div className="panel__body">
            {results.length === 0 && <EmptyState title="No matches">Try a field name, a folder, or a project name.</EmptyState>}
            {results.map((hit) => renderHit(hit))}
          </div>
        </div>
      )}

      {!query && (
        <>
          <div className="panel">
            <div className="panel__head"><Clock3 size={17} /><h3>Recent secrets</h3></div>
            <div className="panel__body">
              {uniqueRecent.length === 0 && <p className="muted">Open a secret to see it here. Only paths are remembered.</p>}
              {uniqueRecent.map((ref) => renderHit({ ...ref, title: ref.path, detail: ref.key ? `field ${ref.key}` : `visited ${formatWhen(new Date(ref.visitedAt).toISOString())}` }))}
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
        Field names come from a temporary KV read of each secret; values are never displayed, logged or persisted.
        {index.data && ` Indexed ${index.data.secrets.length} of ${index.data.total} readable secrets · updated ${formatWhen(new Date(index.data.indexedAt).toISOString())}.`}
        {index.data?.truncated && ` Showing the first ${index.data.secrets.length} secrets.`}
      </p>
    </div>
  );
}
