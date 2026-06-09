import { useEffect } from "react";

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
