// Detect smart-TV browsers by user-agent so the app can switch to a TV-friendly layout.
// The check is stable for the lifetime of the page (UA never changes at runtime).
const TV_UA = /webOS|SmartTV|SMART-TV|HbbTV|NetCast|DLNADOC|Tizen|CrKey/i;

export function isTv(): boolean {
  return TV_UA.test(navigator.userAgent);
}

export function useTvMode(): boolean {
  return isTv();
}
