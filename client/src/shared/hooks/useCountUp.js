import { useEffect, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` over `duration` ms (eased). Returns `target` immediately when the user prefers reduced motion. */
export function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced || typeof target !== 'number') return undefined;
    let raf;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3))); // easeOutCubic
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return reduced ? target : value;
}
