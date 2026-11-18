import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from './Button';

export interface ActiveFilter {
  label: string;
  onClear: () => void;
}

interface FilterBarProps {
  /** Scope selectors, usually `<Field>`s. */
  children?: ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    testId?: string;
  };
  /** Removable chips for active filters. */
  active?: ActiveFilter[];
  onClearAll?: () => void;
  actions?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/**
 * One filter bar for the console: scope selectors on the left, a single search
 * box, then active-filter chips and Clear. Pages keep their own state; this only
 * owns the layout and the shared search input styling.
 */
export function FilterBar({
  children,
  search,
  active = [],
  onClearAll,
  actions,
  ariaLabel = 'Filters',
  className,
}: FilterBarProps) {
  return (
    <div className={`control-bar filter-bar${className ? ` ${className}` : ''}`} role="search" aria-label={ariaLabel}>
      {children && <div className="filter-bar__scope">{children}</div>}
      {search && (
        <div className="search filter-bar__search">
          <Search size={16} aria-hidden="true" />
          <input
            data-testid={search.testId}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            aria-label={search.label ?? search.placeholder ?? 'Search'}
          />
        </div>
      )}
      {active.length > 0 && (
        <div className="filter-bar__chips">
          {active.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className="filter-chip"
              onClick={filter.onClear}
              title={`Remove filter: ${filter.label}`}
            >
              {filter.label}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      {actions && <div className="filter-bar__actions">{actions}</div>}
      {onClearAll && (active.length > 0 || Boolean(search?.value)) && (
        <Button size="small" variant="ghost" onClick={onClearAll}>Clear</Button>
      )}
    </div>
  );
}
