import { useMemo, useState } from 'react';
import { ClipboardCheck, Play, RefreshCw, UserRound } from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { parseHcl, simulateCapabilities, simulatorPaths, type PolicyRule } from '@/lib/policy';
import { useEntities } from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';

interface AccessSimulatorProps {
  project: string;
  env: string;
  policies: string[];
  canSimulate: boolean;
  /** Real KV paths from layout discovery; when absent, fall back to the legacy heuristic. */
  presetPaths?: string[];
  samplePath?: string;
}

type Source = 'real' | 'estimated';

const CAPS = ['create', 'read', 'update', 'delete', 'list', 'sudo', 'deny'] as const;

function hasCap(caps: string[], cap: string): boolean {
  if (caps.includes('deny')) return cap === 'deny';
  if (caps.includes('root')) return cap !== 'deny';
  return caps.includes(cap);
}

function capTone(cap: string, caps: string[]): string {
  if (!hasCap(caps, cap)) return 'cap-cell--off';
  return cap === 'deny' ? 'cap-cell--deny' : 'cap-cell--yes';
}

export function AccessSimulator({ project, env, policies, canSimulate, presetPaths: discoveredPaths, samplePath }: AccessSimulatorProps) {
  const { addToast } = useToast();
  const entities = useEntities();
  const [selected, setSelected] = useState<string[]>(() =>
    ['viewer', 'developer', 'admin'].map((role) => `${project}-${role}`).filter((name) => policies.includes(name)),
  );
  // The "all environments" selector is a policy scope, not a real path segment.
  const [presetPaths] = useState(() =>
    discoveredPaths?.length
      ? discoveredPaths
      : simulatorPaths(project, env === '*' ? 'development' : env),
  );
  const [customPaths, setCustomPaths] = useState('');
  const [entity, setEntity] = useState('');
  const [result, setResult] = useState<CapabilitiesMap | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paths = useMemo(() => {
    const extra = customPaths.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
    return [...new Set([...presetPaths, ...extra])];
  }, [presetPaths, customPaths]);

  function togglePolicy(name: string) {
    setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
    setResult(null);
  }

  async function selectEntity(name: string) {
    setEntity(name);
    if (!name) return;
    try {
      const loaded = await bao.readEntity(name);
      const available = loaded.policies.filter((policy) => policy !== 'default' && policy !== 'root');
      setSelected(available);
      setResult(null);
      addToast('info', `Loaded ${loaded.name}`, available.length ? `${available.length} policies attached to this entity.` : 'No project policies attached.');
    } catch (err) {
      addToast('error', 'Could not load entity', err instanceof Error ? err.message : undefined);
    }
  }

  async function run() {
    if (selected.length === 0 || paths.length === 0) {
      setError('Select at least one policy and one path to check.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (canSimulate) {
        const caps = await bao.simulatePolicies(selected, paths);
        setResult(caps);
        setSource('real');
        addToast('success', 'Simulation complete', 'A temporary token was created and revoked after the check.');
      } else {
        // Fallback: describe the selected policies locally. No token is minted.
        const docs = await Promise.all(selected.map((name) => bao.readPolicy(name).catch(() => null)));
        const rules: PolicyRule[] = [];
        for (const doc of docs) {
          if (!doc) continue;
          const parsed = parseHcl(doc.data.policy);
          if (!parsed.error) rules.push(...parsed.rules);
        }
        if (rules.length === 0) throw new Error('Cannot read the selected policies to simulate them locally.');
        const estimated: CapabilitiesMap = {};
        for (const path of paths) estimated[path] = simulateCapabilities(rules, path);
        setResult(estimated);
        setSource('estimated');
        addToast('warning', 'Estimated locally', 'Your token cannot mint a simulation token, so these capabilities come from the policy HCL.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="panel">
        <div className="panel__head">
          <ClipboardCheck size={17} />
          <h3>Access simulator</h3>
          <span className="small muted">Check what a role or identity can actually reach — no secret values involved</span>
        </div>
        <div className="panel__body grid" style={{ gap: '1rem' }}>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="sim-entity">Start from an identity (optional)</label>
              <select id="sim-entity" value={entity} onChange={(event) => void selectEntity(event.target.value)}>
                <option value="">— Choose policies manually —</option>
                {(entities.data ?? []).slice(0, 120).map((name) => <option value={name} key={name}>{name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-custom">Additional paths (one per line)</label>
              <textarea
                id="sim-custom"
                rows={3}
                className="mono"
                value={customPaths}
                onChange={(event) => { setCustomPaths(event.target.value); setResult(null); }}
                placeholder={samplePath ?? 'kv/data/another-project/env/prod/web'}
              />
            </div>
          </div>

          <div>
            <div className="section-title">Policies to simulate <Badge size="small">{selected.length} selected</Badge></div>
            {policies.length === 0 && <p className="small muted">No ACL policies are visible to this token.</p>}
            <div className="policy-checks" data-testid="simulator-policies">
              {policies.map((name) => (
                <label key={name} className={`cap-check ${selected.includes(name) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    onChange={() => togglePolicy(name)}
                    aria-label={`Simulate policy ${name}`}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>

          <div className="panel-actions">
            <Button icon={busy ? <RefreshCw size={15} /> : <Play size={15} />} loading={busy} onClick={() => void run()} data-testid="simulator-run">
              Run simulation
            </Button>
            <span className="small muted">{paths.length} paths · {canSimulate ? 'real token check' : 'local estimate'}</span>
          </div>

          {error && <div className="notice error small" role="alert">{error}</div>}

          {result && (
            <div>
              <div className="section-title">
                Result
                <Badge size="small" variant={source === 'real' ? 'success' : 'warning'}>
                  {source === 'real' ? 'checked with a temporary token' : 'estimated from HCL'}
                </Badge>
              </div>
              <div className="cap-matrix" data-testid="simulator-result">
                <div className="cap-matrix__row cap-matrix__row--head">
                  <span>Path</span>
                  {CAPS.map((cap) => <span key={cap}>{cap}</span>)}
                </div>
                {paths.map((path) => {
                  const caps = result[path] ?? [];
                  return (
                    <div className="cap-matrix__row" key={path} data-testid={`simulator-result-${path}`}>
                      <span className="mono cap-matrix__path" title={path}>{path}</span>
                      {CAPS.map((cap) => (
                        <span key={cap} className={`cap-cell ${capTone(cap, caps)}`} aria-label={`${cap}: ${hasCap(caps, cap) ? 'allowed' : 'not allowed'}`}>
                          {hasCap(caps, cap) ? '✓' : '—'}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className="small muted"><UserRound size={13} /> Simulation tokens are short-lived and revoked immediately; the token value is never shown or stored.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
