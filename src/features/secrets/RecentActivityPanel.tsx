import { Activity } from 'lucide-react';
import { actorLabel, operationLabel } from '@/lib/audit';
import { formatWhen } from '@/lib/format';
import { useAuditTrail } from '@/lib/queries';
import { Badge } from '@/components/common/Badge';

export function RecentActivityPanel({ path }: { path?: string }) {
  const audit = useAuditTrail(path);
  const entries = audit.data?.entries ?? [];

  return (
    <div className="panel">
      <div className="panel__head">
        <Activity size={17} />
        <h3>Recent activity</h3>
        {entries.length > 0 && <Badge size="small">{entries.length}</Badge>}
      </div>
      <div className="panel__body">
        {!path && <p className="muted">Select a secret to see who touched it.</p>}
        {path && audit.isLoading && <div className="state"><div className="spinner" /></div>}
        {audit.isError && (
          <div className="notice small">
            Audit trail unavailable here — {audit.error instanceof Error ? audit.error.message : 'local log bridge is not running'}. This panel is best-effort and does not block secret browsing.
          </div>
        )}
        {audit.data && entries.length === 0 && <p className="muted">No recent audit entries for this path.</p>}
        {entries.map((entry, index) => (
          <div className="activity-row" key={`${entry.time}-${index}`}>
            <span className="activity-row__dot" aria-hidden="true" />
            <div className="activity-row__main">
              <div className="small"><strong>{actorLabel(entry)}</strong> {operationLabel(entry.operation)} this path</div>
              {entry.path && <div className="small muted mono">{entry.path}</div>}
            </div>
            <span className="small muted">{formatWhen(entry.time)}</span>
          </div>
        ))}
        {entries.length > 0 && <p className="small muted" style={{ marginTop: '0.8rem' }}>From the local OpenBao audit log. Values are never included.</p>}
      </div>
    </div>
  );
}
