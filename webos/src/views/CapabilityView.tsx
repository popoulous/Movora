import React, { useEffect, useRef, useState } from "react";
import { useTvInput } from "../hooks";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import {
  detectCapabilities,
  fetchSamples,
  probePlayback,
  sampleUrl,
  type CapCheck,
  type ProbeResult,
  type ServerSample,
} from "../capabilities";

interface Props {
  onBack: () => void;
}

type ProbeState = "pending" | "playing" | ProbeResult;

const CAT_LABEL: Record<string, string> = {
  video: "Videó codecek",
  container: "Konténerek",
  audio: "Audió codecek",
};

function probeVerdict(category: string, s: ProbeState): { text: string; color: string } {
  if (s === "pending") return { text: "…", color: theme.muted };
  if (s === "playing") return { text: "▶ próba…", color: "#c084fc" };
  if (!s.played) return { text: "✗ Nem megy", color: "#f87171" };
  if (category === "audio") {
    if (s.audioBytes > 0) return { text: "✓ Audió OK", color: "#4ade80" };
    if (s.videoBytes > 0) return { text: "⚠ Videó OK, audió kérdéses", color: "#fbbf24" };
    return { text: "✓ Lejátszható", color: "#4ade80" };
  }
  return { text: "✓ Megy", color: "#4ade80" };
}

function canPlayVerdict(c: CapCheck): { text: string; color: string } {
  if (!c.supported) return { text: "✗", color: "#f87171" };
  const detail = c.canPlay === "probably" ? "biztosan" : c.canPlay === "maybe" ? "talán" : "MSE";
  return { text: `✓ ${detail}`, color: "#4ade80" };
}

function Row({ label, sub, right }: { label: string; sub?: string; right: { text: string; color: string } }): React.JSX.Element {
  return (
    <div
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
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: theme.text }}>{label}</div>
        {sub && (
          <div style={{ fontSize: "0.72rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, marginLeft: "1rem", fontSize: "0.9rem", fontWeight: 700, color: right.color }}>{right.text}</div>
    </div>
  );
}

export default function CapabilityView({ onBack }: Props): React.JSX.Element {
  const { config } = useDevice();
  const base = config?.serverUrl ?? "";
  const [report] = useState(detectCapabilities);
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [results, setResults] = useState<Record<string, ProbeState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Real playback probe: load each server sample and see what actually decodes.
  // Sequential so the TV plays one clip at a time; results stream in.
  useEffect(() => {
    if (!base) return undefined;
    let cancelled = false;
    void (async () => {
      const list = await fetchSamples(base);
      if (cancelled) return;
      setSamples(list);
      for (const s of list) {
        if (cancelled) return;
        if (s.category === "subtitle") continue; // not a <video> source
        setResults((r) => ({ ...r, [s.id]: "playing" }));
        const res = await probePlayback(sampleUrl(base, s.id));
        if (cancelled) return;
        setResults((r) => ({ ...r, [s.id]: res }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: 220, behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: -220, behavior: "smooth" });
    }
  };
  useTvInput(onKey, onBack);

  const categories = ["video", "container", "audio"];
  const probed = samples.filter((s) => s.category !== "subtitle");
  const doneCount = probed.filter((s) => {
    const r = results[s.id];
    return r !== undefined && r !== "playing";
  }).length;

  return (
    <div ref={scrollRef} className="mv-app" style={{ height: "100vh", overflowY: "auto", padding: "2rem 2.5rem 3rem" }}>
      <div style={{ color: theme.muted, fontSize: "0.95rem", marginBottom: "0.5rem" }}>← Vissza</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 0.4rem", color: "#fff" }}>Képességteszt</h1>
      <p style={{ color: theme.muted, fontSize: "0.85rem", margin: "0 0 1.4rem", maxWidth: 820 }}>
        A TV ténylegesen lejátssza a szerver minta-klipjeit, hogy kiderüljön, mit tud dekódolni
        (ez a megbízható próba; a `canPlayType` lentebb csak tájékoztató). Ez alapján a szerver
        eszköz-tudatosan választhat forrást/optimalizálást. (ASS-feliratot a natív lejátszó nem renderel → VTT-t kap.)
      </p>

      {/* Real playback probe */}
      <h2 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff", margin: "0 0 0.3rem" }}>
        Valódi lejátszás-próba {probed.length > 0 ? `(${doneCount}/${probed.length})` : ""}
      </h2>
      {!base && <p style={{ color: "#fbbf24", fontSize: "0.85rem" }}>Nincs szerverkapcsolat — előbb párosíts.</p>}
      {base && samples.length === 0 && <p style={{ color: theme.muted, fontSize: "0.85rem" }}>Minták betöltése…</p>}

      {categories.map((cat) => {
        const items = samples.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginTop: "1rem", marginBottom: "0.4rem" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: theme.text, marginBottom: "0.5rem" }}>{CAT_LABEL[cat]}</div>
            {items.map((s) => (
              <Row key={s.id} label={s.label} sub={s.mime} right={probeVerdict(cat, results[s.id] ?? "pending")} />
            ))}
          </div>
        );
      })}

      {/* canPlayType reference */}
      <h2 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff", margin: "1.8rem 0 0.6rem" }}>canPlayType (tájékoztató)</h2>
      {[
        { title: "Videó", checks: report.video },
        { title: "Audió", checks: report.audio },
        { title: "Konténer", checks: report.container },
      ].map((g) => (
        <div key={g.title} style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 700, color: theme.muted, marginBottom: "0.4rem" }}>{g.title}</div>
          {g.checks.map((c) => (
            <Row key={c.id} label={c.label} sub={c.mime} right={canPlayVerdict(c)} />
          ))}
        </div>
      ))}

      <div style={{ color: theme.muted, fontSize: "0.78rem", marginTop: "0.5rem" }}>▲▼ Görgetés · Back Vissza</div>
    </div>
  );
}
