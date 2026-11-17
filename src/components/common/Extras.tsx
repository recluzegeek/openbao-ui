import { useEffect, useRef, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { useClipboard } from '@/lib/useClipboard';
import { envTone } from '@/lib/baoPaths';

export function CopyButton({ value, label = 'Copy', className = '' }: { value: string; label?: string; className?: string }) {
  const copy = useClipboard();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      className={`icon-btn ${className}`}
      title={label}
      aria-label={label}
      data-testid={label.toLowerCase().replace(/\s+/g, '-')}
      onClick={async () => {
        await copy(value, `${label} copied`);
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

export function CodeSnippet({ text, label }: { text: string; label: string }) {
  return (
    <div className="snippet">
      <div className="snippet__copy">
        <CopyButton value={text} label={`Copy ${label}`} />
      </div>
      <code>{text}</code>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="state">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const text = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="state">
      <h3>Could not load this view</h3>
      <p>{text}</p>
      {onRetry && (
        <button className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function EnvBadge({ env }: { env: string }) {
  return <span className={`kv-badge ${envTone(env)}`}>{env}</span>;
}
