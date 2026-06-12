import React, { useEffect, useState } from "react";
import { theme } from "../theme";
import logo from "../assets/movora_logo.png";

// A visual-only boot overlay: dark neon backdrop, the Movora mark with an orbiting
// ring loader (not a plain spinner), a status line, and the server URL. It never
// blocks app init — it just sits on top, stays a minimum time, then fades out.
// webOS Chrome 79 safe: only transform / opacity / box-shadow + @keyframes (injected
// via a <style>, since keyframes can't live in an inline style), no `inset` shorthand
// (Chrome 87+), no GIF/Lottie/heavy deps.

const MIN_MS = 1800; // minimum visibility so the boot doesn't flash
const FADE_MS = 600;

interface Props {
  serverUrl?: string | null;
  ready?: boolean; // false keeps the splash up (e.g. while a slow server connects)
  onDone: () => void;
}

const KEYFRAMES = `
@keyframes mv-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes mv-pulse { 0%, 100% { transform: scale(1); filter: drop-shadow(0 0 14px rgba(122,77,255,0.6)); } 50% { transform: scale(1.06); filter: drop-shadow(0 0 28px rgba(236,72,153,0.8)); } }
@keyframes mv-dot { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
`;

const FILL = { top: 0, left: 0, right: 0, bottom: 0 } as const;

function dotStyle(angle: number, color: string): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 16,
    height: 16,
    marginTop: -8,
    marginLeft: -8,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 14px ${color}`,
    transform: `rotate(${angle}deg) translateX(100px)`,
    animation: "mv-dot 1.6s ease-in-out infinite",
  };
}

export default function SplashScreen({
  serverUrl,
  ready = true,
  onDone,
}: Props): React.JSX.Element {
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const fading = minElapsed && ready;

  useEffect(() => {
    if (!fading) return undefined;
    const timer = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [fading, onDone]);

  return (
    <div
      style={{
        position: "fixed",
        ...FILL,
        zIndex: 1000,
        background: "radial-gradient(circle at 50% 38%, #181034 0%, #05060B 62%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <style>{KEYFRAMES}</style>

      <div style={{ position: "relative", width: 248, height: 248, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: 26, left: 26, right: 26, bottom: 26, borderRadius: "50%", border: "2px solid rgba(168,85,247,0.18)" }} />
        <div style={{ position: "absolute", ...FILL, animation: "mv-orbit 3.2s linear infinite" }}>
          <span style={dotStyle(0, "#7A4DFF")} />
          <span style={dotStyle(120, "#EC4899")} />
          <span style={dotStyle(240, "#a855f7")} />
        </div>
        <img
          src={logo}
          alt="Movora"
          style={{
            width: 124,
            height: 124,
            display: "block",
            animation: "mv-pulse 2.4s ease-in-out infinite",
          }}
        />
      </div>

      <div style={{ marginTop: "1.9rem", fontSize: "2rem", fontWeight: 800, letterSpacing: "0.2em", color: "#fff" }}>MOVORA</div>
      <div style={{ marginTop: "0.7rem", fontSize: "1.05rem", color: theme.muted }}>Médiatár betöltése…</div>
      {serverUrl ? (
        <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "rgba(192,132,252,0.9)" }}>
          Kapcsolódás: {serverUrl}
        </div>
      ) : null}
    </div>
  );
}
