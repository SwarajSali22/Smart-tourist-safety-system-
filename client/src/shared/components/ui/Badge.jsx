/**
 * Small coloured label.
 * variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
 */
function Badge({ children, variant = 'neutral' }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

export default Badge;
