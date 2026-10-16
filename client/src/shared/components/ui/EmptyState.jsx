/** Friendly empty state: icon, one line of context, optional next action. */
function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={28} aria-hidden="true" className="empty-state__icon" />}
      <p className="empty-state__title">{title}</p>
      {children && <p className="empty-state__text">{children}</p>}
      {action}
    </div>
  );
}

export default EmptyState;
