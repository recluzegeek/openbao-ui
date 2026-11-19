import { useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { Eye, EyeOff, GitCompareArrows } from 'lucide-react';
import { bao, type KVResponse } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { formatWhen, mask } from '@/lib/format';
import { EnvBadge, EmptyState } from '@/components/common/Extras';
import { Button } from '@/components/common/Button';

type DifferenceReason = 'missing' | 'value';

function EnvColumn({ env, query, keys, revealed, different }: {
  env: string;
  query: UseQueryResult<KVResponse>;
  keys: string[];
  revealed: boolean;
  different: Map<string, DifferenceReason>;
}) {
  const data = (query.data?.data.data ?? {}) as Record<string, unknown>;
  const meta = query.data?.data.metadata;
  return (
    <div className="compare-col">
      <div className="compare-col__head">
        <EnvBadge env={env} />
        {meta && <span className="small muted">v{meta.version} · {formatWhen(meta.created_time)}</span>}
      </div>
      {query.isLoading && <div className="state"><div className="spinner" /></div>}
      {query.isError && <div className="notice warning small">Not readable with this token.</div>}
      {query.isSuccess && keys.length === 0 && <p className="small muted">No fields.</p>}
      {keys.map((key) => {
        const present = Object.prototype.hasOwnProperty.call(data, key);
        const value = data[key];
        const reason = different.get(key);
        const badge = !present ? 'missing here'
          : reason === 'value' ? 'value differs'
            : reason === 'missing' ? 'set elsewhere' : undefined;
        return (
          <div className={`compare-field ${present ? '' : 'compare-field--missing'} ${reason ? 'compare-field--different' : ''}`} key={key} data-testid={`compare-${env}-${key}`}>
            <span className="compare-field__key mono" title={key}>
              {key}
              {badge && <span className="compare-field__badge" data-testid={`compare-badge-${env}-${key}`}>{badge}</span>}
            </span>
            <span className={`compare-field__value mono ${revealed ? '' : 'masked'}`} title={revealed && present ? String(value ?? '') : undefined}>
              {!present ? '—' : revealed ? String(value ?? '') : mask(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Modal content for the Compare action. Values stay masked until revealed. */
export function CompareEnvsPanel({ project, path, envs }: { project: string; path: string; envs: string[] }) {
  const [revealed, setRevealed] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const results = useQueries({
    queries: envs.map((env) => ({
      queryKey: ['secret', project, env, path, 'compare'],
      queryFn: () => bao.readSecret(secretApiPath(project, env, path)),
      retry: false,
    })),
  });
  const payloads = results.map((result) => (result.data?.data.data ?? {}) as Record<string, unknown>);
  const keys = [...new Set(payloads.flatMap((payload) => Object.keys(payload)))].sort();
  const different = new Map<string, DifferenceReason>();
  for (const key of keys) {
    const present = payloads.map((payload) => Object.prototype.hasOwnProperty.call(payload, key));
    if (present.some((value) => !value)) different.set(key, 'missing');
    else if (new Set(payloads.map((payload) => String(payload[key] ?? ''))).size > 1) different.set(key, 'value');
  }
  const shownKeys = onlyDiff ? keys.filter((key) => different.has(key)) : keys;

  return (
    <div className="compare-view" data-testid="compare-envs">
      <div className="compare-toolbar">
        <span className="small muted mono">{path}</span>
        <span className="small muted">{different.size} of {keys.length} fields differ</span>
        <label className="check-row">
          <input type="checkbox" checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />
          Only differences
        </label>
        <Button
          size="small"
          variant="outlined"
          data-testid="compare-reveal"
          icon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? 'Hide values' : 'Reveal values'}
        </Button>
      </div>
      {keys.length === 0 && results.every((result) => result.isSuccess) && (
        <EmptyState title="No fields to compare">This path has no fields in any readable environment.</EmptyState>
      )}
      {shownKeys.length > 0 && (
        <div className="compare-grid" data-testid="compare-grid">
          {envs.map((env, index) => (
            <EnvColumn key={env} env={env} query={results[index]} keys={shownKeys} revealed={revealed} different={different} />
          ))}
        </div>
      )}
      {shownKeys.length > 0 && (
        <p className="small muted">
          <GitCompareArrows size={12} /> {different.size} of {keys.length} fields differ —{' '}
          {[...different.values()].filter((reason) => reason === 'value').length} by value and{' '}
          {[...different.values()].filter((reason) => reason === 'missing').length} because a field is absent in an environment.
          Badges explain why. Values stay masked until you reveal them deliberately.
        </p>
      )}
    </div>
  );
}
