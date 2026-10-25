import { useEffect, useId, useRef, useState } from 'react';

/**
 * Accessible modal confirm. Focuses the dialog on open, closes on Escape or
 * backdrop click, keeps Tab inside, and restores focus to the opener.
 * Children (e.g. a note textarea) render between the message and the buttons.
 */
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const ref = useRef(null);
  // Stay mounted for the short exit animation (visual only: the action has already happened).
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return undefined; }
    setClosing(true);
    const id = setTimeout(() => { setMounted(false); setClosing(false); }, 170);
    return () => clearTimeout(id);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const titleId = useId();
  // Parents pass a fresh onCancel every render. Keep it in a ref so the effect below
  // runs only when the dialog opens/closes — otherwise every keystroke inside the
  // dialog re-ran it and stole focus back from the input being typed into.
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    ref.current?.focus();

    function onKey(e) {
      if (e.key === 'Escape') {
        cancelRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className={`modal-backdrop${closing ? ' modal-backdrop--closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className={`modal${closing ? ' modal--closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <h2 id={titleId} className="modal__title">{title}</h2>
        {message && <p className="modal__message">{message}</p>}
        {children}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
