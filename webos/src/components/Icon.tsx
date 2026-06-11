import React from "react";

// Inline SVG icons — webOS Chrome 87 doesn't render emoji / many unicode glyphs,
// so the transport buttons use these instead of text symbols.
const ICONS: Record<string, React.ReactNode> = {
  play: <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </>
  ),
  prev: (
    <>
      <polygon points="18 19 8 12 18 5 18 19" fill="currentColor" />
      <rect x="5" y="5" width="2.6" height="14" rx="1" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <polygon points="6 5 16 12 6 19 6 5" fill="currentColor" />
      <rect x="16.4" y="5" width="2.6" height="14" rx="1" fill="currentColor" />
    </>
  ),
  rewind: (
    <>
      <polygon points="11 18 3 12 11 6 11 18" fill="currentColor" />
      <polygon points="21 18 13 12 21 6 21 18" fill="currentColor" />
    </>
  ),
  forward: (
    <>
      <polygon points="13 18 21 12 13 6 13 18" fill="currentColor" />
      <polygon points="3 18 11 12 3 6 3 18" fill="currentColor" />
    </>
  ),
  subtitles: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 14h5M15 14h2M7 10h2M12 10h5" />
    </g>
  ),
  settings: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.2" fill="currentColor" />
      <circle cx="15" cy="12" r="2.2" fill="currentColor" />
      <circle cx="8" cy="17" r="2.2" fill="currentColor" />
    </g>
  ),
  skip: (
    <g fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <polygon points="5 5 14 12 5 19 5 5" />
      <rect x="16" y="5" width="2.6" height="14" rx="1" stroke="none" />
    </g>
  ),
  back: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 6 9 12 15 18" />
    </g>
  ),
  close: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </g>
  ),
  globe: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.7 2.6 2.7 15.4 0 18M12 3c-2.7 2.6-2.7 15.4 0 18" />
    </g>
  ),
  monitor: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </g>
  ),
  key: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="3.5" />
      <path d="M10 10l9 9" />
      <path d="M16 16l-1.8 1.8M18.2 18.2l-1.8 1.8" />
    </g>
  ),
  refresh: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </g>
  ),
  unlink: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 14.5 7 17a3.5 3.5 0 0 1-5-5l2.5-2.5" />
      <path d="M14.5 9.5 17 7a3.5 3.5 0 0 1 5 5l-2.5 2.5" />
      <path d="M19 5l1.6-1.6M5 19l-1.6 1.6" />
    </g>
  ),
};

export function Icon({ name, size = 24 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
