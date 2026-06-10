import React, { useRef, useState } from "react";
import { useTvInput } from "../hooks";
import { theme } from "../theme";
import { detectCapabilities, type CapCheck } from "../capabilities";

interface Props {
  onBack: () => void;
}

function verdict(c: CapCheck): { text: string; color: string } {
  if (!c.supported) return { text: "✗ Nem", color: "#f87171" };
  const detail = c.canPlay === "probably" ? "biztosan" : c.canPlay === "maybe" ? "talán" : "MSE";
  return { text: `✓ Megy (${detail})`, color: "#4ade80" };
}

function Section({ title, checks }: { title: string; checks: CapCheck[] }): React.JSX.Element {
  return (
    <div style={{ marginBottom: "1.4rem" }}>
      <div style={{ fontSize: "1rem", fontWeight: 700, color: theme.text, marginBottom: "0.5rem" }}>{title}</div>
      {checks.map((c) => {
        const v = verdict(c);
        return (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0.5rem 0.8rem",
              marginBottom: "0.35rem",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: theme.text }}>{c.label}</div>
              <div style={{ fontSize: "0.72rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.mime}</div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: "1rem", fontSize: "0.9rem", fontWeight: 700, color: v.color }}>{v.text}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function CapabilityView({ onBack }: Props): React.JSX.Element {
  const [report] = useState(detectCapabilities);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: 200, behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: -200, behavior: "smooth" });
    }
  };

  useTvInput(onKey, onBack);

  const summary = [
    `Videó: ${report.video_codecs.join(", ") || "—"}`,
    `Audió: ${report.audio_codecs.join(", ") || "—"}`,
    `Konténer: ${report.containers.join(", ") || "—"}`,
  ];

  return (
    <div ref={scrollRef} className="mv-app" style={{ height: "100vh", overflowY: "auto", padding: "2rem 2.5rem 3rem" }}>
      <div style={{ color: theme.muted, fontSize: "0.95rem", marginBottom: "0.5rem" }}>← Vissza</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 0.4rem", color: "#fff" }}>Képességteszt</h1>
      <p style={{ color: theme.muted, fontSize: "0.85rem", margin: "0 0 1.2rem", maxWidth: 760 }}>
        Mit tud dekódolni ez a TV (canPlayType + MediaSource). Ez alapján a szerver eszköz-tudatosan
        választhat forrást/optimalizálást. (Az ASS-feliratot a natív lejátszó nem rendereli, ezért VTT-t kap.)
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          marginBottom: "1.6rem",
        }}
      >
        {summary.map((s) => (
          <span
            key={s}
            style={{
              padding: "0.4rem 0.9rem",
              borderRadius: 999,
              background: "rgba(122,77,255,0.16)",
              color: "#fff",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            {s}
          </span>
        ))}
      </div>

      <Section title="Videó codecek" checks={report.video} />
      <Section title="Audió codecek" checks={report.audio} />
      <Section title="Konténerek" checks={report.container} />

      <div style={{ color: theme.muted, fontSize: "0.78rem", marginTop: "0.5rem" }}>▲▼ Görgetés · Back Vissza</div>
    </div>
  );
}
