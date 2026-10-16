import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle, danger: AlertTriangle };
const DURATION = { success: 4000, info: 5000, warning: 8000, error: 8000, danger: 12000 };

/**
 * Lightweight toast system. `const toast = useToast(); toast.success('Saved')`.
 * Errors/danger are announced assertively (role="alert"), the rest politely.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (variant, message, opts = {}) => {
      const id = ++idRef.current;
      setToasts((ts) => [...ts.slice(-4), { id, variant, message, title: opts.title }]);
      const ms = opts.duration ?? DURATION[variant];
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      warning: (m, o) => push('warning', m, o),
      danger: (m, o) => push('danger', m, o),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region">
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          const urgent = t.variant === 'error' || t.variant === 'danger';
          return (
            <div
              key={t.id}
              className={`toast toast--${t.variant}`}
              role={urgent ? 'alert' : 'status'}
              aria-live={urgent ? 'assertive' : 'polite'}
            >
              <Icon size={18} aria-hidden="true" className="toast__icon" />
              <div className="toast__body">
                {t.title && <strong>{t.title}</strong>}
                <span>{t.message}</span>
              </div>
              <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
