import React, { useEffect, useState } from "react";
import { theme } from "../theme";
import logo from "../assets/movora_logo.png";

export interface NavTab {
  id: string;
  label: string;
}

interface Props {
  tabs: NavTab[];
  activeId: string;
  focusIdx: number; // index of the focused tab, or -1 when this zone isn't active
  onActivate: (id: string) => void;
}

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return <span style={{ color: theme.muted, fontSize: "1rem", fontVariantNumeric: "tabular-nums" }}>{hh}:{mm}</span>;
}

export function TopNav({ tabs, activeId, focusIdx, onActivate }: Props): React.JSX.Element {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        padding: "1.1rem 2.5rem",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginRight: "3.5rem" }}>
        <img src={logo} alt="" style={{ width: 34, height: 34, display: "block" }} />
        <span
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            background: theme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Movora
        </span>
      </span>

      <nav style={{ display: "flex", alignItems: "center", flex: 1 }}>
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const focused = i === focusIdx;
          return (
            <span
              key={tab.id}
              onClick={() => onActivate(tab.id)}
              style={{
                marginRight: "1.6rem",
                padding: "0.35rem 0.9rem",
                borderRadius: 999,
                fontSize: "1.05rem",
                fontWeight: active || focused ? 700 : 500,
                cursor: "pointer",
                color: focused ? "#fff" : active ? "#fff" : theme.muted,
                background: focused ? theme.gradient : active ? "rgba(122,77,255,0.18)" : "transparent",
                boxShadow: focused ? "0 0 16px rgba(122,77,255,0.6)" : "none",
              }}
            >
              {tab.label}
            </span>
          );
        })}
      </nav>

      <Clock />
    </header>
  );
}
