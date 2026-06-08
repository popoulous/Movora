import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  // Reject zero-size or off-screen elements
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

type Direction = "up" | "down" | "left" | "right";

function findNearest(current: Element, direction: Direction): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el !== current && isVisible(el),
  );

  const cr = current.getBoundingClientRect();
  const cx = (cr.left + cr.right) / 2;
  const cy = (cr.top + cr.bottom) / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of all) {
    const r = el.getBoundingClientRect();
    const ex = (r.left + r.right) / 2;
    const ey = (r.top + r.bottom) / 2;

    // Only consider elements that are clearly in the requested direction
    const ok =
      (direction === "up" && ey < cy - 4) ||
      (direction === "down" && ey > cy + 4) ||
      (direction === "left" && ex < cx - 4) ||
      (direction === "right" && ex > cx + 4);
    if (!ok) continue;

    // Score: primary distance + 2× perpendicular (prefer aligned elements)
    const primary =
      direction === "up" || direction === "down" ? Math.abs(ey - cy) : Math.abs(ex - cx);
    const perp =
      direction === "up" || direction === "down" ? Math.abs(ex - cx) : Math.abs(ey - cy);
    const score = primary + perp * 2;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

const DIR_MAP: Partial<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function useSpatialNav(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    // Auto-focus the first interactive element so D-pad has a starting point.
    if (!document.activeElement || document.activeElement === document.body) {
      document.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const dir = DIR_MAP[e.key];
      if (dir === undefined) return;

      const active = document.activeElement;
      if (active === null) return;

      // Let the <video> element keep its own arrow-key bindings (seek / volume).
      if (active.tagName === "VIDEO") return;

      const next = findNearest(active, dir);
      if (next !== null) {
        e.preventDefault();
        next.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
