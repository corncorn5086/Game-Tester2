import { useEffect, useRef, useState } from 'react';

/** Reveal-on-scroll: adds .in to any [data-rv] node when it enters the viewport. */
export function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    const attach = () => document.querySelectorAll('[data-rv]:not(.in)').forEach((el) => observer.observe(el));
    attach();
    // catch nodes mounted after first paint (tab switches etc.)
    const mo = new MutationObserver(attach);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mo.disconnect();
    };
  }, []);
}

/** Track scroll for nav solidify + stage fade. Returns { scrolled, stageOpacity }. */
export function useScrollFx() {
  const [scrolled, setScrolled] = useState(false);
  const [stageOpacity, setStageOpacity] = useState(1);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 40);
      setStageOpacity(Math.max(0.06, 1 - y / (window.innerHeight * 0.9)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return { scrolled, stageOpacity };
}

/** Cycling terminal feed used in the Solution section. */
export function useTerminalFeed(lines, { stepMs = 650, restMs = 2600 } = {}) {
  const [visible, setVisible] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    const tick = () => {
      setVisible((v) => {
        if (v >= lines.length) {
          timer.current = setTimeout(() => {
            setVisible(0);
            timer.current = setTimeout(tick, stepMs);
          }, restMs);
          return v;
        }
        timer.current = setTimeout(tick, stepMs);
        return v + 1;
      });
    };
    timer.current = setTimeout(tick, stepMs);
    return () => clearTimeout(timer.current);
  }, [lines.length, stepMs, restMs]);
  return visible;
}
