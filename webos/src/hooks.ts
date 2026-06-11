import { useEffect, useRef } from "react";

// Reliable focus visibility: measure the focused element against its scrolling page
// container (.mv-app) and scroll just enough that it's fully in view. This replaces
// scrollIntoView({block:"nearest"}) for the vertical axis, which on webOS could leave
// the top element (e.g. the nav bar) clipped — only its bottom edge showing. Horizontal
// centering of card rows stays with scrollIntoView({inline:"center"}).
export function scrollIntoFocus(el: HTMLElement, topMargin = 16, bottomMargin = 24): void {
  const scroller = el.closest(".mv-app");
  if (!(scroller instanceof HTMLElement)) return;
  const e = el.getBoundingClientRect();
  const c = scroller.getBoundingClientRect();
  if (e.top < c.top + topMargin) {
    scroller.scrollTop -= c.top + topMargin - e.top; // element above the fold -> scroll up
  } else if (e.bottom > c.bottom - bottomMargin) {
    scroller.scrollTop += e.bottom - (c.bottom - bottomMargin); // below the fold -> scroll down
  }
}

// Our custom views aren't Sandstone Panels, so nothing grabs initial Spotlight
// focus — and with nothing focused the D-pad does nothing. Once `ready` flips
// truthy (content rendered), focus the first card/button so 5-way nav can start.
export function useInitialFocus(ready: unknown): void {
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      const el =
        document.querySelector(".mv-row .spottable") ??
        document.querySelector(".mv-grid .spottable") ??
        document.querySelector(".spottable");
      if (el instanceof HTMLElement) el.focus();
    }, 80);
    return () => clearTimeout(id);
  }, [ready]);
}

// Explicit TV input: capture keys at the document level (a focused <div> is
// unreliable on webOS) and route the remote Back (which fires history.back(), not
// a keydown) through popstate. The view drives all focus from React state — no
// browser focus / Spotlight involved. Same approach the player uses.
export function useTvInput(onKey: (e: KeyboardEvent) => void, onBack: () => void): void {
  const keyRef = useRef(onKey);
  const backRef = useRef(onBack);
  useEffect(() => {
    keyRef.current = onKey;
    backRef.current = onBack;
  });
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack" || e.keyCode === 461) {
        e.preventDefault();
        history.back();
        return;
      }
      keyRef.current(e);
    };
    const handlePop = (): void => backRef.current();
    document.addEventListener("keydown", handleKey, true);
    window.addEventListener("popstate", handlePop);
    history.pushState({ mv: true }, "");
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("popstate", handlePop);
    };
  }, []);
}
