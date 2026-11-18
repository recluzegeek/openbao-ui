import type { CSSProperties, ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one labelled form field used across the console: 40px inputs, 8px radius
 * and the same label/hint/error rhythm (see `.field` in global.css).
 */
export function Field({ label, htmlFor, hint, error, children, className, style }: FieldProps) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`} style={style}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="small muted">{hint}</p>}
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
