import { useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Activity, RefreshCw, Search, ShieldCheck, ShieldX } from 'lucide-react';
import {
  AUDIT_RANGES,
  actorLabel,
  auditCsv,
  auditPathHref,
  filterAuditEntries,
  operationLabel,
  type AuditFilters,
  type AuditRange,
} from '@/lib/audit';
import { formatWhen } from '@/lib/format';
import { useAuditLog } from '@/lib/queries';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CopyButton, EmptyState, ErrorState } from '@/components/common/Extras';

type AuditSearch = {
  q: string | undefined;
  actor: string | undefined;
  operation: string | undefined;
  range: string | undefined;
};

const EMPTY_SEARCH: AuditSearch = { q: undefined, actor: undefined, operation: undefined, range: undefined };

export function AuditPage() {
  const navigate = useNavigate({ from: '/audit' });
  const search = useRouterState({ select: (state) => state.location.search }) as AuditSearch;
  const audit = useAuditLog();

  const filters: AuditFilters = {
    search: search.q ?? '',
    actor: search.actor ?? 'all',
    operation: search.operation ?? 'all',
    range: (AUDIT_RANGES.some((item) => item.id === search.range) ? search.range : 'all') as AuditRange,
  };

  function setFilter(key: keyof AuditSearch, value: string | undefined) {
    void navigate({
      search: (prev) => ({ ...prev, [key]: value }) as AuditSearch,
      replace: true,
    });
  }

  const entries = audit.data?.entries ?? [];
  const actors = useMemo(
    () => [...new Set(entries.map(actorLabel))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const operations = useMemo(
    () => [...new Set(entries.map((entry) => entry.operation ?? 'request'))].sort(),
    [entries],
  );
  const visible = useMemo(
    () => filterAuditEntries(entries, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filters.search, filters.actor, filters.operation, filters.range],
  );
  const allowedCount = visible.filter((entry) => entry.allowed === true).length;
  const deniedCount = visible.filter((entry) => entry.allowed === false).length;
  const csv = auditCsv(visible);

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="page__header">
        <div>
          <p>Who changed what, where and when — metadata only, never secret values.</p>
        </div>
        <div className="topbar__actions">
          <Badge variant="primary"><Activity size={13} /> {entries.length} loaded</Badge>
          <Button
            size="small"
            variant="outlined"
            icon={audit.isFetching ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
            onClick={() => void audit.refetch()}
          >
            Refresh
          </Button>
          <CopyButton value={csv} label="Copy audit CSV" />
        </div>
      </div>

      {audit.data?.available !== false && (
        <div className="control-bar audit-filters" role="search" aria-label="Audit log filters">
        <div className="search search--large">
          <Search size={16} />
          <input
            id="audit-search"
            data-testid="audit-search"
            value={filters.search}
            onChange={(event) => setFilter('q', event.target.value || undefined)}
            placeholder="Search path, actor, action or policy…"
            aria-label="Search audit log"
          />
        </div>
        <label className="small muted" htmlFor="audit-actor">Actor</label>
        <select
          id="audit-actor"
          data-testid="audit-actor"
          value={filters.actor}
          onChange={(event) => setFilter('actor', event.target.value === 'all' ? undefined : event.target.value)}
        >
          <option value="all">All actors</option>
          {actors.map((actor) => <option value={actor} key={actor}>{actor}</option>)}
        </select>
        <label className="small muted" htmlFor="audit-operation">Action</label>
        <select
          id="audit-operation"
          data-testid="audit-operation"
          value={filters.operation}
          onChange={(event) => setFilter('operation', event.target.value === 'all' ? undefined : event.target.value)}
        >
          <option value="all">All actions</option>
          {operations.map((operation) => <option value={operation} key={operation}>{operationLabel(operation)}</option>)}
        </select>
        <label className="small muted" htmlFor="audit-range">Time</label>
        <select
          id="audit-range"
          data-testid="audit-range"
          value={filters.range}
          onChange={(event) => setFilter('range', event.target.value === 'all' ? undefined : event.target.value)}
        >
          {AUDIT_RANGES.map((range) => <option value={range.id} key={range.id}>{range.label}</option>)}
        </select>
        {(filters.search || filters.actor !== 'all' || filters.operation !== 'all' || filters.range !== 'all') && (
          <Button size="small" variant="ghost" onClick={() => void navigate({ search: EMPTY_SEARCH, replace: true })}>Clear</Button>
        )}
        </div>
      )}

      {audit.isError && <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />}
      {!audit.isError && audit.isLoading && <div className="state"><div className="spinner" /></div>}
      {!audit.isError && audit.data?.available === false && (
        <EmptyState title="Audit log is not configured">
          This deployment has no audit log provider. Secret browsing is unaffected.
        </EmptyState>
      )}
      {!audit.isError && audit.data && audit.data.available !== false && entries.length === 0 && (
        <EmptyState title="No audit entries loaded">
          No matching activity was returned by the configured audit provider.
        </EmptyState>
      )}
      {!audit.isError && entries.length > 0 && visible.length === 0 && (
        <EmptyState title="No matching entries">Try clearing a filter or widening the time range.</EmptyState>
      )}

      {visible.length > 0 && (
        <>
          <div className="audit-summary">
            <span><Badge size="small" variant="primary">{visible.length} shown</Badge></span>
            <span><ShieldCheck size={14} className="ok" /> {allowedCount} allowed</span>
            <span><ShieldX size={14} className="bad" /> {deniedCount} denied</span>
            <span className="small muted">Newest first · automatic refresh every 30s</span>
          </div>

          <div className="audit-table" data-testid="audit-table" role="table" aria-label="Audit entries">
            <div className="audit-row audit-row--head" role="row">
              <span role="columnheader">Time</span>
              <span role="columnheader">Actor</span>
              <span role="columnheader">Action</span>
              <span role="columnheader">Path</span>
              <span role="columnheader">Result</span>
            </div>
            {visible.map((entry, index) => {
              const href = auditPathHref(entry.path);
              return (
                <div className="audit-row" role="row" key={`${entry.time}-${index}`} data-testid={`audit-entry-${index}`}>
                  <span className="small muted" role="cell" title={entry.time}>{formatWhen(entry.time)}</span>
                  <span className="small" role="cell">{actorLabel(entry)}</span>
                  <span role="cell"><Badge size="small" variant="outline">{operationLabel(entry.operation)}</Badge></span>
                  <span className="small mono audit-row__path" role="cell" title={entry.path}>
                    {href ? <a href={href}>{entry.path}</a> : (entry.path ?? '—')}
                  </span>
                  <span role="cell">
                    {entry.allowed === undefined ? (
                      <span className="small muted">—</span>
                    ) : (
                      <Badge size="small" variant={entry.allowed ? 'success' : 'danger'}>
                        {entry.allowed ? 'allowed' : 'denied'}
                      </Badge>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
