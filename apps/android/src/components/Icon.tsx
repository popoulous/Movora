import React from 'react';
import Svg, {Circle, G, Line, Path, Polygon, Polyline, Rect} from 'react-native-svg';

// Inline vector icons — the React Native port of apps/webos' Icon component, so the
// transport controls look the same across clients. `color` replaces SVG's currentColor.
const ICONS: Record<string, (color: string) => React.ReactNode> = {
  // Library kind markers (match the web's lucide Sparkles / Film / Tv).
  anime: color => (
    <Path d="M12 3 L13.8 9.5 L20.5 12 L13.8 14.5 L12 21 L10.2 14.5 L3.5 12 L10.2 9.5 Z" fill={color} />
  ),
  movie: color => (
    <G fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round">
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
    </G>
  ),
  series: color => (
    <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="6" width="18" height="12" rx="2" />
      <Path d="M8 21h8M12 18v3" />
    </G>
  ),
  play: color => <Polygon points="6 4 20 12 6 20 6 4" fill={color} />,
  pause: color => (
    <>
      <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
      <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
    </>
  ),
  prev: color => (
    <>
      <Polygon points="18 19 8 12 18 5 18 19" fill={color} />
      <Rect x="5" y="5" width="2.6" height="14" rx="1" fill={color} />
    </>
  ),
  next: color => (
    <>
      <Polygon points="6 5 16 12 6 19 6 5" fill={color} />
      <Rect x="16.4" y="5" width="2.6" height="14" rx="1" fill={color} />
    </>
  ),
  subtitles: color => (
    <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Rect x="3" y="5" width="18" height="14" rx="2" />
      <Path d="M7 14h5M15 14h2M7 10h2M12 10h5" />
    </G>
  ),
  audio: color => (
    <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9v6h4l5 4V5L8 9H4z" fill={color} stroke="none" />
      <Path d="M16 8.5a4 4 0 0 1 0 7" />
      <Path d="M18.6 6a7 7 0 0 1 0 12" />
    </G>
  ),
  settings: color => (
    <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Line x1="4" y1="7" x2="20" y2="7" />
      <Line x1="4" y1="12" x2="20" y2="12" />
      <Line x1="4" y1="17" x2="20" y2="17" />
      <Circle cx="9" cy="7" r="2.2" fill={color} />
      <Circle cx="15" cy="12" r="2.2" fill={color} />
      <Circle cx="8" cy="17" r="2.2" fill={color} />
    </G>
  ),
  skip: color => (
    <G fill={color} stroke={color} strokeWidth={2} strokeLinejoin="round">
      <Polygon points="5 5 14 12 5 19 5 5" />
      <Rect x="16" y="5" width="2.6" height="14" rx="1" stroke="none" />
    </G>
  ),
  back: color => (
    <G fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="15 6 9 12 15 18" />
    </G>
  ),
};

export function Icon({
  name,
  size = 24,
  color = '#fff',
}: {
  name: string;
  size?: number;
  color?: string;
}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ICONS[name]?.(color)}
    </Svg>
  );
}
