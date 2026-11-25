'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up once when it scrolls into view. The server renders the final value (so it
 * is right without JavaScript and for screen readers); motion is skipped when reduced motion is on.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Only animate numbers that start below the fold (never rewind one the reader already sees).
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setValue(0);
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / 1200);
          setValue(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
