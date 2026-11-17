import { useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { Columns3, Eye, EyeOff } from 'lucide-react';
import { bao, type KVResponse } from '@/lib/api';
import { secretApiPath } from '@/lib/baoPaths';
import { formatWhen, mask } from '@/lib/format';
import { EnvBadge } from '@/components/common/Extras';
import { Button } from '@/components/common/Button';

function EnvColumn({ env, query, keys, revealed }: {
  env: string;
  query: UseQueryResult<KVResponse>;
  keys: string[];
  revealed: boolean;
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
          <div className={`compare-field ${present ? '' : 'compare-field--missing'}`} key={key} data-testid={`compare-${env}-${key}`}>
            <span className="compare-field__key mono" title={key}>{key}</span>
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
  const results = useQueries({
    queries: envs.map((env) => ({
      queryKey: ['secret', project, env, path, 'compare'],
      queryFn: () => bao.readSecret(secretApiPath(project, env, path)),
      retry: false,
    })),
  });
  const keys = [...new Set(results.flatMap((result) => Object.keys(result.data?.data.data ?? {})))].sort();

  return (
    <div className="panel">
      <div className="panel__head">
        <Columns3 size={17} />
        <h3>Environments side by side</h3>
        <span className="small muted mono">{path}</span>
        <Button size="small" variant="outlined" icon={revealed ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setRevealed((value) => !value)}>
          {revealed ? 'Hide values' : 'Reveal values'}
        </Button>
      </div>
      <div className="panel__body">
        <div className="compare-grid">
          {envs.map((env, index) => (
            <EnvColumn key={env} env={env} query={results[index]} keys={keys} revealed={revealed} />
          ))}
        </div>
        <p className="small muted" style={{ marginTop: '0.8rem' }}>
          Values stay masked until you reveal them deliberately. A dash means the field is absent in that environment.
        </p>
      </div>
    </div>
  );
}
