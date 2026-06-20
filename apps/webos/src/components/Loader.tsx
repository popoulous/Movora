import React from "react";
import { theme } from "../theme";

// The unified Movora loading indicator: an orbiting tri-colour ring (the same motif as the
// boot SplashScreen) instead of a plain spinner, so every loading state looks consistent.
// webOS Chrome 79 safe: only transform/opacity + @keyframes injected via <style>.
const KEYFRAMES = `
@keyframes mv-loader-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes mv-loader-dot { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
`;

function dotStyle(angle: number, color: string, radius: number, d: number): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: d,
    height: d,
    marginTop: -d / 2,
    marginLeft: -d / 2,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 ${d}px ${color}`,
    transform: `rotate(${angle}deg) translateX(${radius}px)`,
    animation: "mv-loader-dot 1.6s ease-in-out infinite",
  };
}

export function Loader({
  size = 72,
  label,
}: {
  size?: number;
  label?: string;
}): React.JSX.Element {
  const radius = size * 0.42;
  const d = Math.max(8, Math.round(size * 0.1));
  const inset = Math.round(size * 0.08);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: label ? "1.1rem" : 0 }}>
      <style>{KEYFRAMES}</style>
      <div style={{ position: "relative", width: size, height: size }}>
        <div style={{ position: "absolute", top: inset, left: inset, right: inset, bottom: inset, borderRadius: "50%", border: "2px solid rgba(168,85,247,0.18)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, animation: "mv-loader-orbit 3.2s linear infinite" }}>
          <span style={dotStyle(0, "#7A4DFF", radius, d)} />
          <span style={dotStyle(120, "#EC4899", radius, d)} />
          <span style={dotStyle(240, "#a855f7", radius, d)} />
        </div>
      </div>
      {label ? <div style={{ color: theme.muted, fontSize: "0.95rem" }}>{label}</div> : null}
    </div>
  );
}
