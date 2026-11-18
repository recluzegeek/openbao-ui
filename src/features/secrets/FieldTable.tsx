import { useState } from 'react';
import { Eye, EyeOff, Link2, MessageSquareText, SlidersHorizontal, Trash2, UserRound } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { CopyButton } from '@/components/common/Extras';
import { mask } from '@/lib/format';
import { findReferences, resolveReferences } from '@/lib/secretFormats';
import { fieldNameError, type FieldRow } from '@/lib/secretForm';

interface FieldTableProps {
  rows: FieldRow[];
  revealAll: boolean;
  comments: Record<string, string>;
  overrides: Record<string, string>;
  /** ${path.FIELD} -> value map for the current environment. */
  lookup: Record<string, string>;
  onRowChange: (id: string, patch: Partial<FieldRow>) => void;
  onRemove: (id: string) => void;
  onCommentChange: (key: string, value: string) => void;
  onOverrideChange: (key: string, value: string | null) => void;
}

export function FieldTable({
  rows, revealAll, comments, overrides, lookup,
  onRowChange, onRemove, onCommentChange, onOverrideChange,
}: FieldTableProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const nameCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const name = row.key.trim();
    if (name) counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="field-table" data-testid="field-table">
      <div className="field-table__head" aria-hidden="true">
        <span>Field</span>
        <span>Value</span>
        <span>Annotations</span>
        <span />
      </div>
      {rows.map((row) => {
        const isRevealed = revealAll || Boolean(revealed[row.id]);
        const isExpanded = Boolean(expanded[row.id]);
        const references = findReferences(row.value);
        const resolved = references.length ? resolveReferences(row.value, lookup) : '';
        const hasOverride = Object.prototype.hasOwnProperty.call(overrides, row.key);
        const hasComment = Boolean(comments[row.key]?.trim());
        const name = row.key.trim();
        const nameError = fieldNameError(row.key)
          ?? (name && nameCounts[name] > 1 ? 'Duplicate field name.' : null);
        const showNameError = Boolean(name && nameError);
        return (
          <div className="field-table__row" key={row.id} data-testid={`edit-row-${row.key || 'new'}`}>
            <div className="field-table__cell field-table__cell--key">
              <input
                aria-label="Field name"
                className="mono"
                placeholder="FIELD_NAME"
                value={row.key}
                aria-invalid={showNameError}
                onChange={(event) => onRowChange(row.id, { key: event.target.value })}
              />
              {showNameError && (
                <span className="field-table__error" role="alert" data-testid={`field-error-${name}`}>{nameError}</span>
              )}
              {references.length > 0 && (
                <span className="field-table__hint" title={`References ${references.join(', ')}`}>
                  <Link2 size={12} /> {references.length} reference{references.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="field-table__cell field-table__cell--value">
              {isRevealed ? (
                <textarea
                  aria-label={`Value for ${row.key || 'new field'}`}
                  className="mono"
                  rows={row.value.includes('\n') ? Math.min(row.value.split('\n').length + 1, 8) : 1}
                  placeholder="value"
                  value={row.value}
                  onChange={(event) => onRowChange(row.id, { value: event.target.value })}
                  data-testid={`edit-value-${row.key || 'new'}`}
                />
              ) : (
                <button
                  type="button"
                  className="field-table__masked mono"
                  onClick={() => setRevealed((current) => ({ ...current, [row.id]: true }))}
                  aria-label={`Reveal value for ${row.key || 'new field'}`}
                >
                  {mask(row.value)} <Eye size={13} />
                </button>
              )}
              <span className="field-table__row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={isRevealed ? `Hide ${row.key || 'field'}` : `Reveal ${row.key || 'field'}`}
                  title={isRevealed ? 'Hide value' : 'Reveal value'}
                  onClick={() => setRevealed((current) => ({ ...current, [row.id]: !isRevealed }))}
                >
                  {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <CopyButton value={row.value} label={`Copy ${row.key || 'field'}`} />
              </span>
            </div>
            <div className="field-table__cell field-table__cell--meta">
              <button
                type="button"
                className={`btn btn--ghost btn--small ${isExpanded ? 'is-active' : ''}`}
                onClick={() => setExpanded((current) => ({ ...current, [row.id]: !isExpanded }))}
                aria-expanded={isExpanded}
                aria-label={`Annotations for ${row.key || 'field'}`}
              >
                <SlidersHorizontal size={13} />
                {hasComment && <MessageSquareText size={13} aria-label="has comment" />}
                {hasOverride && <UserRound size={13} aria-label="has personal override" />}
              </button>
              <span className="field-table__badges">
                {hasComment && <Badge size="small" variant="outline">comment</Badge>}
                {hasOverride && <Badge size="small" variant="info">override</Badge>}
              </span>
            </div>
            <div className="field-table__cell field-table__cell--remove">
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${row.key || 'field'}`}
                title="Remove field"
                onClick={() => onRemove(row.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {isExpanded && (
              <div className="field-table__details">
                <div className="field">
                  <label>Comment for this field</label>
                  <input
                    className="mono"
                    placeholder="e.g. rotate with the DBA team"
                    value={comments[row.key] ?? ''}
                    onChange={(event) => onCommentChange(row.key, event.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Personal override (only visible to you)</label>
                  <div className="field-table__inline">
                    <input
                      className="mono"
                      placeholder="no override"
                      value={overrides[row.key] ?? ''}
                      onChange={(event) => onOverrideChange(row.key, event.target.value)}
                    />
                    {hasOverride && (
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => onOverrideChange(row.key, null)}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                {references.length > 0 && (
                  <div className="field">
                    <label>Resolved preview</label>
                    <code className="field-table__resolved mono">{resolved}</code>
                    <p className="small muted">Stored value keeps the reference; this preview resolves it against this environment.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <p className="small muted">No fields yet. Add one below or import a file.</p>}
    </div>
  );
}
