import { useEffect, useState } from 'react';

/**
 * Wide windows (1200 px and up) keep the no-scroll layout of PLAN.md §5.1: table and chart side by side, sized to
 * the viewport. Narrower windows stack the panels at their natural height and let the page scroll.
 */
export const WIDE_QUERY = '(min-width: 1200px)';

export function useWide(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true);
  const [wide, setWide] = useState(query);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}
