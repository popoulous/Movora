import { useEffect, useRef } from "react";

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
