import type { FocusEvent } from "react";

// On a TV the page doesn't follow the D-pad on its own — when a card/button gains
// focus, scroll it into view (both axes: vertical page + horizontal row).
export function scrollFocus(e: FocusEvent<HTMLElement>): void {
  e.currentTarget.scrollIntoView({ block: "nearest", inline: "center" });
}

// webOS Chrome 87 has no CSS `aspect-ratio` — compute an explicit pixel height.
export function aspectHeight(width: number, aspect: "2/3" | "16/9"): number {
  return aspect === "16/9" ? Math.round((width * 9) / 16) : Math.round((width * 3) / 2);
}
