import { useState } from 'react';
import { RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';

/**
 * P2 #19: one place that explains what the signed-in token can do. `lookup-self`
 * splits direct token policies from identity-group policies; `resultant-acl`
 * confirms the merged set. This is metadata only — no secret values are read.
 */
export function EffectiveAccessCard() {
  const auth = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const identity = auth.identity;
  const groupPolicies = identity?.identity_policies ?? [];
  const allPolicies = identity?.policies ?? [];

  async function refresh() {
    setRefreshing(true);
    try {
      await auth.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <details className="panel effective-access" data-testid="effective-access-card" open>
      <summary className="panel__head effective-access__head">
        <ShieldCheck size={17} />
        <h3>Your effective access</h3>
        <Badge size="small" variant={auth.effectivePolicies ? 'success' : 'outline'}>
          {allPolicies.length} polic{allPolicies.length === 1 ? 'y' : 'ies'}
        </Badge>
        <span className="small muted effective-access__hint">
          {auth.effectivePolicies ? 'token + identity groups' : 'token policies only'}
        </span>
        <Button
          size="small"
          variant="ghost"
          icon={<RefreshCw size={14} className={refreshing ? 'spin' : ''} />}
          onClick={(event) => {
            event.preventDefault();
            void refresh();
          }}
          disabled={refreshing}
          data-testid="effective-access-refresh"
        >
          Check again
        </Button>
      </summary>
      <div className="panel__body effective-access__body">
        <div className="effective-access__block">
          <span className="section-title">All effective policies</span>
          <div className="method-chips">
            {allPolicies.length === 0 && <span className="small muted">No policies reported for this token.</span>}
            {allPolicies.map((policy) => (
              <span className="method-chip" key={policy} data-testid={`effective-policy-${policy}`}>
                <code>{policy}</code>
              </span>
            ))}
          </div>
        </div>
        <div className="effective-access__block">
          <span className="section-title"><Users size={13} /> From identity groups</span>
          {groupPolicies.length === 0 ? (
            <p className="small muted">
              No group policies were reported. A token without an entity has none, and some servers hide
              them from <code>lookup-self</code>.
            </p>
          ) : (
            <div className="method-chips">
              {groupPolicies.map((policy) => <span className="method-chip" key={policy}><code>{policy}</code></span>)}
            </div>
          )}
        </div>
        <p className="small muted">
          Effective access is the union of the token's own policies and those attached to its identity groups.
          {identity?.entity_id && <> Entity <span className="mono">{identity.entity_id}</span>.</>}{' '}
          OpenBao still enforces each request against these policies; the console only uses them to hide actions you cannot take.
        </p>
      </div>
    </details>
  );
}
