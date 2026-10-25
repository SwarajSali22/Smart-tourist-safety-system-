import { useState } from 'react';

/**
 * Minimal SVG charts (no dependency). Single series → one hue, no legend; the
 * card title names the series. Thin marks, rounded data-ends on the baseline,
 * recessive grid, hover/focus tooltip, and a visually-hidden table so the same
 * numbers are available to screen readers.
 */

const niceMax = (max) => {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / pow) * pow;
};

export function BarChart({ data, title, unit = 'incidents', height = 180, onSelect }) {
  const [active, setActive] = useState(null);
  const W = 560;
  const pad = { l: 28, r: 8, t: 10, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const step = innerW / data.length;
  const barW = Math.min(18, step * 0.6);
  const ticks = [0, max / 2, max];
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <figure className="chart" aria-label={`${title}: ${total} ${unit} in total`}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}. Bar chart, ${data.length} periods, ${total} ${unit} in total.`}>
        {ticks.map((t) => {
          const y = pad.t + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="chart__grid" />
              <text x={pad.l - 6} y={y + 4} textAnchor="end" className="chart__tick">{Math.round(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = pad.l + step * i + (step - barW) / 2;
          const y = pad.t + innerH - h;
          const showLabel = data.length <= 8 || i % 2 === 0 || i === data.length - 1;
          return (
            <g key={d.label}>
              {d.value > 0 && (
                <path
                  className="chart__bar"
                  d={`M${x},${pad.t + innerH} V${y + 4} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 V${pad.t + innerH} Z`}
                  style={{ opacity: active === null || active === i ? 1 : 0.45 }}
                />
              )}
              {showLabel && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="chart__tick">{d.short}</text>
              )}
              <rect
                x={pad.l + step * i}
                y={pad.t}
                width={step}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${d.value} ${unit}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={onSelect ? 'chart__hit' : undefined}
                onClick={onSelect ? () => onSelect(d) : undefined}
                onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(d); } } : undefined}
                role={onSelect ? 'link' : undefined}
              />
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <div className="chart__tip" style={{ left: `${((pad.l + step * (active + 0.5)) / W) * 100}%` }} role="status">
          <strong>{data[active].value}</strong> {unit}
          <small>{data[active].label}</small>
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Period</th><th>{unit}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for ranked categories (direct value labels, one hue). */
export function HBarChart({ data, title, unit = '', onSelect }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="hbars" aria-label={title}>
      <ul>
        {data.map((d) => (
          <li key={d.label} className={onSelect ? 'hbars__item--link' : undefined}
            onClick={onSelect ? () => onSelect(d) : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter') onSelect(d); } : undefined}
            tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'link' : undefined}
            aria-label={onSelect ? `${d.label}: ${d.value}. Open the matching incidents` : undefined}>
            <span className="hbars__label">{d.label}</span>
            <span className="hbars__track" aria-hidden="true">
              <span style={{ width: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="hbars__value">{d.value}{unit}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
