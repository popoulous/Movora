import { useEffect, useState } from "react";

const TV_UA = /webOS|SmartTV|SMART-TV|HbbTV|NetCast|DLNADOC|Tizen|CrKey/i;
const LS_KEY = "movora.tvMode";
const EVENT = "movora:tvmode";

function detectTv(): boolean {
  const override = localStorage.getItem(LS_KEY);
  if (override === "on") return true;
  if (override === "off") return false;
  return TV_UA.test(navigator.userAgent);
}

/** True only when the UA matches a known smart-TV browser (ignores manual override). */
export function isTv(): boolean {
  return TV_UA.test(navigator.userAgent);
}

/** Returns "on"/"off" if manually overridden, null if following auto-detect. */
export function getTvOverride(): "on" | "off" | null {
  return localStorage.getItem(LS_KEY) as "on" | "off" | null;
}

/**
 * Set a manual TV-mode override.
 * Pass null to remove the override and fall back to UA auto-detection.
 */
export function setTvModeOverride(value: boolean | null): void {
  if (value === null) {
    localStorage.removeItem(LS_KEY);
  } else {
    localStorage.setItem(LS_KEY, value ? "on" : "off");
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Reactive hook: returns true when TV/10-foot mode is active.
 * Responds to manual overrides set via setTvModeOverride() without a page reload.
 */
export function useTvMode(): boolean {
  const [tv, setTv] = useState(detectTv);
  useEffect(() => {
    const sync = () => setTv(detectTv());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return tv;
}
