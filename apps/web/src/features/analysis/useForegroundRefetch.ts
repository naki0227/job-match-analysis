import { useEffect, useRef } from "react";

/**
 * Browsers pause timers and may drop in-flight requests while a page is in
 * the background (mobile Safari, installed PWAs, bfcache). When the page is
 * usable again, `refetch` runs once so a job that finished meanwhile shows up
 * immediately. Events that arrive together on return (visibilitychange,
 * focus, pageshow, online) collapse into one call.
 */
export function useForegroundRefetch(
  active: boolean,
  refetch: () => void,
  minGapMs = 1_000,
): void {
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });

  useEffect(() => {
    if (!active) return;
    let last = Number.NEGATIVE_INFINITY;
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < minGapMs) return;
      last = now;
      latest.current();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [active, minGapMs]);
}
