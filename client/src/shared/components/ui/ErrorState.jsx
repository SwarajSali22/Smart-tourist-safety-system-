import { TriangleAlert } from 'lucide-react';

/** Consistent "this failed to load" block with a retry button. */
function ErrorState({ message = 'Something went wrong while loading this.', onRetry, compact = false }) {
  return (
    <div className={`error-state${compact ? ' error-state--compact' : ''}`} role="alert">
      <TriangleAlert size={compact ? 18 : 26} aria-hidden="true" />
      <div>
        <p className="error-state__title">Couldn’t load this</p>
        <p className="error-state__text">{message}</p>
      </div>
      {onRetry && <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export default ErrorState;
