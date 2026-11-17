import { useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { Columns3, Eye, EyeOff, GitCompareArrows } from 'lucide-react';
import { bao, type KVResponse } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { formatWhen, mask } from '@/lib/format';
import { EnvBadge } from '@/components/common/Extras';
import { Button } from '@/components/common/Button';

function EnvColumn({ env, query, keys, revealed, different }: {
  env: string;
  query: UseQueryResult<KVResponse>;
  keys: string[];
  revealed: boolean;
  different: Set<string>;
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
        return (
          <div className={`compare-field ${present ? '' : 'compare-field--missing'} ${different.has(key) ? 'compare-field--different' : ''}`} key={key} data-testid={`compare-${env}-${key}`}>
            <span className="compare-field__key mono" title={key}>
              {key}
              {different.has(key) && <span className="compare-field__badge">differs</span>}
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
  const different = new Set(keys.filter((key) => {
    const present = payloads.map((payload) => Object.prototype.hasOwnProperty.call(payload, key));
    if (present.some((value) => !value)) return true;
    return new Set(payloads.map((payload) => String(payload[key] ?? ''))).size > 1;
  }));
  const shownKeys = onlyDiff ? keys.filter((key) => different.has(key)) : keys;

  return (
    <div className="panel">
      <div className="panel__head">
        <Columns3 size={17} />
        <h3>Environments side by side</h3>
        <span className="small muted mono">{path}</span>
        <label className="check-row">
          <input type="checkbox" checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />
          Only differences
        </label>
        <Button size="small" variant="outlined" icon={revealed ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setRevealed((value) => !value)}>
          {revealed ? 'Hide values' : 'Reveal values'}
        </Button>
      </div>
      <div className="panel__body">
        <div className="compare-grid">
          {envs.map((env, index) => (
            <EnvColumn key={env} env={env} query={results[index]} keys={shownKeys} revealed={revealed} different={different} />
          ))}
        </div>
        <p className="small muted" style={{ marginTop: '0.8rem' }}>
          <GitCompareArrows size={12} /> {different.size} of {keys.length} fields differ. Values stay masked until you reveal
          them deliberately. A dash means the field is absent in that environment.
        </p>
      </div>
    </div>
  );
}
