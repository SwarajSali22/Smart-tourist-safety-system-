/** Placeholder blocks shown while data loads (layout stays put, unlike a lone spinner). */
export function Skeleton({ height = 16, width = '100%', style }) {
  return <span className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={18} width={`${90 - (i % 3) * 12}%`} />
      ))}
    </div>
  );
}

export default Skeleton;
