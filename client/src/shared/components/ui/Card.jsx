function Card({ title, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title && <h3 className="card__title">{title}</h3>}
      <div className="card__body">{children}</div>
    </div>
  );
}

export default Card;
