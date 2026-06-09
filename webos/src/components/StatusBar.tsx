import React from "react";
import { theme } from "../theme";

// Bottom status strip (server reachable + Direct Play hint). Kept lightweight; the
// live normalization progress can attach later from the tasks API.
export function StatusBar(): React.JSX.Element {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        gap: "2rem",
        padding: "0.7rem 2.5rem",
        background: "rgba(5,6,11,0.85)",
        borderTop: `1px solid ${theme.border}`,
        color: theme.muted,
        fontSize: "0.85rem",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
        Szerver online
      </span>
      <span>▶ Direct Play: készen áll</span>
    </div>
  );
}
