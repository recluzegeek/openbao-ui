import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: ToastAction;
}

interface ToastContextValue {
  addToast: (kind: ToastKind, title: string, message?: string, action?: ToastAction) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <AlertCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (kind: ToastKind, title: string, message?: string, action?: ToastAction) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-3), { id, kind, title, message, action }]);
      window.setTimeout(() => dismiss(id), action ? 10_000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ addToast, dismiss }), [addToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            {icons[toast.kind]}
            <div>
              <strong>{toast.title}</strong>
              {toast.message && <div className="small muted">{toast.message}</div>}
            </div>
            {toast.action && (
              <button
                className="link-btn"
                style={{ marginLeft: 'auto', flex: 'none', fontWeight: 600 }}
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button className="icon-btn" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" style={{ marginLeft: toast.action ? 0 : 'auto' }}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
