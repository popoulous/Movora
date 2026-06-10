import React, { useEffect, useRef, useState } from "react";
import { useTvInput } from "../hooks";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import {
  fetchSamples,
  probeAudio,
  probePlayback,
  probeSubtitle,
  resumeAudioContext,
  sampleUrl,
  type ProbeResult,
  type ServerSample,
} from "../capabilities";
import { type CapabilityProbeOutcome, type CapabilityReportBody } from "../api/client";

interface Props {
  onBack: () => void;
}

type ProbeState = "pending" | "playing" | ProbeResult;

const CAT_LABEL: Record<string, string> = {
  video: "Videó codecek / felbontás",
  container: "Konténerek",
  audio: "Audió codecek (van-e tényleg hang)",
  subtitle: "Feliratok",
};
const CATEGORIES = ["video", "container", "audio", "subtitle"];

function verdict(category: string, s: ProbeState): { text: string; color: string } {
  if (s === "pending") return { text: "…", color: theme.muted };
  if (s === "playing") return { text: "▶ próba…", color: "#c084fc" };
  if (category === "subtitle") {
    return (s.cues ?? 0) > 0
      ? { text: `✓ Renderelhető (${s.cues} sor)`, color: "#4ade80" }
      : { text: "✗ Konvertálás kell", color: "#fbbf24" };
  }
  if (!s.played) return { text: "✗ Nem megy", color: "#f87171" };
  if (category === "audio") {
    const rms = s.audioRms !== null ? ` (rms ${Math.round(s.audioRms)})` : "";
    if (s.hasAudio === true) return { text: `✓ Hang OK${rms}`, color: "#4ade80" };
    if (s.hasAudio === false) return { text: `✗ Nincs hang${rms}`, color: "#f87171" };
    return { text: "✓ Lejátszható (hang nem mérhető)", color: "#fbbf24" };
  }
  return { text: "✓ Megy", color: "#4ade80" };
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
  const { config, api } = useDevice();
  const base = config?.serverUrl ?? "";
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [results, setResults] = useState<Record<string, ProbeState>>({});
  const [sent, setSent] = useState<"idle" | "ok" | "error">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Real probe: play each sample (video/container), measure real audio output
  // (audio), or parse cues (subtitle). Sequential; then report the profile back.
  useEffect(() => {
    if (!base) return undefined;
    let cancelled = false;
    void (async () => {
      resumeAudioContext(); // best-effort: the Enter that opened this screen is the gesture
      const list = await fetchSamples(base);
      if (cancelled) return;
      setSamples(list);
      const collected: Record<string, ProbeResult> = {};
      for (const s of list) {
        if (cancelled) return;
        setResults((r) => ({ ...r, [s.id]: "playing" }));
        const url = sampleUrl(base, s.id);
        const res =
          s.category === "audio"
            ? await probeAudio(url)
            : s.category === "subtitle"
              ? await probeSubtitle(url)
              : await probePlayback(url);
        if (cancelled) return;
        collected[s.id] = res;
        setResults((r) => ({ ...r, [s.id]: res }));
      }
      if (cancelled || !api) return;
      const probe: Record<string, CapabilityProbeOutcome> = {};
      for (const s of list) {
        const r = collected[s.id];
        if (r) {
          probe[s.id] = {
            played: r.played,
            video_bytes: r.videoBytes,
            audio_bytes: r.audioBytes,
            has_audio: r.hasAudio,
            audio_rms: r.audioRms,
            cues: r.cues,
          };
        }
      }
      const cues = (id: string): boolean => (collected[id]?.cues ?? 0) > 0;
      const body: CapabilityReportBody = {
        probe,
        supports_vtt: cues("vtt_subtitle_test"),
        supports_srt: cues("srt_subtitle_test"),
        supports_ass: cues("ass_subtitle_test"),
        user_agent: navigator.userAgent,
      };
      try {
        await api.reportCapabilities(body);
        if (!cancelled) setSent("ok");
      } catch {
        if (!cancelled) setSent("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, api]);

  const onKey = (e: KeyboardEvent): void => {
    resumeAudioContext(); // any remote key counts as the gesture that unlocks audio
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: 240, behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: -240, behavior: "smooth" });
    }
  };
  useTvInput(onKey, onBack);

  const doneCount = samples.filter((s) => {
    const r = results[s.id];
    return r !== undefined && r !== "playing";
  }).length;
  const playingAudio = samples.find((s) => s.category === "audio" && results[s.id] === "playing") ?? null;

  return (
    <div ref={scrollRef} className="mv-app" style={{ height: "100vh", overflowY: "auto", padding: "2rem 2.5rem 3rem" }}>
      <div style={{ color: theme.muted, fontSize: "0.95rem", marginBottom: "0.5rem" }}>← Vissza</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 0.4rem", color: "#fff" }}>
        Képességteszt {samples.length > 0 ? `(${doneCount}/${samples.length})` : ""}
      </h1>
      <p style={{ color: theme.muted, fontSize: "0.85rem", margin: "0 0 1rem", maxWidth: 880 }}>
        A TV ténylegesen lejátssza a szerver minta-klipjeit. A videónál a dekódolást, az audiónál a
        <b style={{ color: theme.text }}> tényleges hangot</b> (Web Audio jel) — így a „kép megy, de nincs hang"
        eset is kiderül —, a feliratnál a natív renderelést méri. A végén elküldi a profilt a szervernek.
      </p>

      {!base && <p style={{ color: "#fbbf24", fontSize: "0.9rem" }}>Nincs szerverkapcsolat — előbb párosíts.</p>}
      {base && samples.length === 0 && <p style={{ color: theme.muted, fontSize: "0.9rem" }}>Minták betöltése…</p>}
      {sent === "ok" && <p style={{ color: "#4ade80", fontSize: "0.9rem", fontWeight: 700 }}>✓ Profil elküldve a szervernek</p>}
      {sent === "error" && <p style={{ color: "#f87171", fontSize: "0.9rem" }}>A profil küldése nem sikerült.</p>}

      {playingAudio !== null && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: "rgba(122,77,255,0.25)",
            border: `2px solid ${theme.accent}`,
            borderRadius: 12,
            padding: "0.8rem 1.1rem",
            margin: "0.4rem 0 1rem",
          }}
        >
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#fff" }}>Most szól: {playingAudio.label}</div>
          <div style={{ fontSize: "0.85rem", color: theme.text }}>
            Hallasz hangot? Ha NEM szól, ezt az audió-codecet a TV nem tudja.
          </div>
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const items = samples.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginTop: "1.1rem", marginBottom: "0.4rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>{CAT_LABEL[cat]}</div>
            {items.map((s) => (
              <Row key={s.id} label={s.label} sub={s.mime} right={verdict(cat, results[s.id] ?? "pending")} />
            ))}
          </div>
        );
      })}

      <div style={{ color: theme.muted, fontSize: "0.78rem", marginTop: "1rem" }}>▲▼ Görgetés · Back Vissza</div>
    </div>
  );
}
