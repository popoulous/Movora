import React, { useEffect, useRef, useState } from "react";
import { useTvInput } from "../hooks";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import { Icon } from "../components/Icon";
import {
  fetchSamples,
  probePlayback,
  probeSubtitle,
  sampleUrl,
  type ProbeResult,
  type ServerSample,
} from "../capabilities";
import { type CapabilityProbeOutcome, type CapabilityReportBody } from "../api/client";

interface Props {
  onBack: () => void;
}

// Auto-probe state for the passive (video/container/subtitle) categories.
type ProbeState = "pending" | "playing" | ProbeResult;
type Answer = "yes" | "no";

const CAT_LABEL: Record<string, string> = {
  video: "Videó codecek / felbontás",
  container: "Konténerek",
  audio: "Audió codecek — hallgasd meg (van-e tényleg hang)",
  subtitle: "Feliratok",
};
const CATEGORIES = ["video", "container", "audio", "subtitle"];

function verdict(category: string, s: ProbeState): { text: string; color: string } {
  if (s === "pending") return { text: "…", color: theme.muted };
  if (s === "playing") return { text: "próba…", color: "#c084fc" };
  if (category === "subtitle") {
    return (s.cues ?? 0) > 0
      ? { text: `Renderelhető (${s.cues} sor)`, color: "#4ade80" }
      : { text: "Konvertálás kell", color: "#fbbf24" };
  }
  if (!s.played) return { text: "Nem megy", color: "#f87171" };
  return { text: "Megy", color: "#4ade80" };
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

function playBtnStyle(active: boolean, playing: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46,
    borderRadius: 999,
    color: "#fff",
    background: playing ? theme.gradient : theme.surfaceStrong,
    border: active ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
    boxShadow: active ? "0 0 0 3px rgba(122,77,255,0.4)" : "none",
    flexShrink: 0,
  };
}

function pillStyle(active: boolean, selected: Answer | null, kind: Answer): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.5rem 1.2rem",
    borderRadius: 999,
    fontSize: "0.95rem",
    fontWeight: 700,
    color: theme.text,
    border: `1px solid ${theme.border}`,
    background: theme.surface,
    marginLeft: "0.55rem",
    flexShrink: 0,
  };
  if (selected === kind) {
    base.background = kind === "yes" ? "#15803d" : "#b91c1c";
    base.color = "#fff";
    base.border = `1px solid ${kind === "yes" ? "#15803d" : "#b91c1c"}`;
  }
  if (active) {
    base.border = `2px solid ${theme.accent}`;
    base.boxShadow = "0 0 0 3px rgba(122,77,255,0.4)";
  }
  return base;
}

export default function CapabilityView({ onBack }: Props): React.JSX.Element {
  const { config, api } = useDevice();
  const base = config?.serverUrl ?? "";
  const [samples, setSamples] = useState<ServerSample[]>([]);
  const [results, setResults] = useState<Record<string, ProbeState>>({}); // video/container/subtitle
  const [answers, setAnswers] = useState<Record<string, Answer>>({}); // audio, answered by ear
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sent, setSent] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [probing, setProbing] = useState(true); // auto-probes (video/container/subtitle) still running
  const [fRow, setFRow] = useState(0);
  const [fCol, setFCol] = useState(0);
  const audioElRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const audioSamples = samples.filter((s) => s.category === "audio");
  const sendRow = audioSamples.length; // the focus row of the "send" button
  const rowCount = audioSamples.length + 1;
  const answered = audioSamples.filter((s) => answers[s.id] !== undefined).length;

  // Auto-probe only the categories we *can* measure (video/container/subtitle).
  // Audio is confirmed by ear below, so it is intentionally skipped here.
  useEffect(() => {
    if (!base) return undefined;
    let cancelled = false;
    void (async () => {
      const list = await fetchSamples(base);
      if (cancelled) return;
      setSamples(list);
      for (const s of list) {
        if (s.category === "audio") continue;
        if (cancelled) return;
        setResults((r) => ({ ...r, [s.id]: "playing" }));
        const url = sampleUrl(base, s.id);
        const res = s.category === "subtitle" ? await probeSubtitle(url) : await probePlayback(url);
        if (cancelled) return;
        setResults((r) => ({ ...r, [s.id]: res }));
      }
      // Only now is it safe to play audio by ear: this TV has a single decoder,
      // so a running video probe would mute the audio sample.
      if (!cancelled) setProbing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  // Once the auto-probes finish, scroll the audio section into view and keep the
  // focused row visible. While probing we stay put (audio can't play yet).
  useEffect(() => {
    if (probing) return;
    rowRefs.current.get(fRow)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [fRow, probing, audioSamples.length]);

  const togglePlay = (s: ServerSample): void => {
    if (probing) return; // a running video probe would mute the audio sample
    const el = audioElRef.current;
    if (el === null) return;
    if (playingId === s.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = sampleUrl(base, s.id);
    el.currentTime = 0;
    el.volume = 1;
    void el.play().catch(() => undefined);
    setPlayingId(s.id);
  };

  const doSend = async (): Promise<void> => {
    if (!api) return;
    setSent("sending");
    const probe: Record<string, CapabilityProbeOutcome> = {};
    for (const s of samples) {
      if (s.category === "audio") {
        const a = answers[s.id];
        probe[s.id] = {
          played: a !== undefined, // we got a verdict for it
          video_bytes: 0,
          audio_bytes: 0,
          has_audio: a === undefined ? null : a === "yes", // by-ear answer
          audio_rms: null,
          cues: null,
        };
      } else {
        const r = results[s.id];
        if (r !== undefined && typeof r === "object") {
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
    }
    const cueOk = (id: string): boolean => {
      const r = results[id];
      return r !== undefined && typeof r === "object" ? (r.cues ?? 0) > 0 : false;
    };
    const body: CapabilityReportBody = {
      probe,
      supports_vtt: cueOk("vtt_subtitle_test"),
      supports_srt: cueOk("srt_subtitle_test"),
      supports_ass: cueOk("ass_subtitle_test"),
      user_agent: navigator.userAgent,
    };
    try {
      await api.reportCapabilities(body);
      setSent("ok");
    } catch {
      setSent("error");
    }
  };

  const activate = (): void => {
    if (fRow === sendRow) {
      void doSend();
      return;
    }
    const s = audioSamples[fRow];
    if (s === undefined) return;
    if (fCol === 0) togglePlay(s);
    else if (fCol === 1) setAnswers((a) => ({ ...a, [s.id]: "yes" }));
    else if (fCol === 2) setAnswers((a) => ({ ...a, [s.id]: "no" }));
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (probing) {
      // Auto-probes still running — only allow reading/scrolling, no audio yet.
      if (k === "ArrowDown") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: 280, behavior: "smooth" });
      } else if (k === "ArrowUp") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: -280, behavior: "smooth" });
      }
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      if (fRow < rowCount - 1) setFRow(fRow + 1);
      else scrollRef.current?.scrollBy({ top: 280, behavior: "smooth" });
    } else if (k === "ArrowUp") {
      e.preventDefault();
      if (fRow > 0) setFRow(fRow - 1);
      else scrollRef.current?.scrollBy({ top: -280, behavior: "smooth" });
    } else if (k === "ArrowRight") {
      e.preventDefault();
      if (fRow < sendRow) setFCol(Math.min(fCol + 1, 2));
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      if (fRow < sendRow) setFCol(Math.max(fCol - 1, 0));
    } else if (k === "Enter") {
      e.preventDefault();
      activate();
    }
  };
  useTvInput(onKey, onBack);

  const autoSamples = samples.filter((s) => s.category !== "audio");
  const autoDone = autoSamples.filter((s) => {
    const r = results[s.id];
    return r !== undefined && r !== "playing";
  }).length;
  const sendLabel =
    sent === "sending"
      ? "Küldés…"
      : sent === "ok"
        ? "Elküldve — kész"
        : sent === "error"
          ? "Hiba — Enter az újraküldéshez"
          : "Profil elküldése";

  return (
    <div ref={scrollRef} className="mv-app" style={{ height: "100vh", overflowY: "auto", padding: "2rem 2.5rem 3rem" }}>
      <video
        ref={audioElRef}
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
        playsInline
        style={{ position: "fixed", left: "-9999px", width: 1, height: 1 }}
      />

      <div style={{ color: theme.muted, fontSize: "0.95rem", marginBottom: "0.5rem" }}>← Vissza</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 0.4rem", color: "#fff" }}>Képességteszt</h1>
      <p style={{ color: theme.muted, fontSize: "0.85rem", margin: "0 0 1rem", maxWidth: 880 }}>
        A videó/konténer/felirat mintákat a TV automatikusan próbálja. Az <b style={{ color: theme.text }}>audiónál</b> nincs
        megbízható gépi mérés ezen a TV-n, ezért minden mintát lejátszhatsz, és <b style={{ color: theme.text }}>füllel</b> jelölöd
        be: <b style={{ color: theme.text }}>Igen</b> (szól) vagy <b style={{ color: theme.text }}>Nem</b> (néma). A végén a
        <b style={{ color: theme.text }}> Profil elküldése</b> gomb küldi el a szervernek.
      </p>

      {!base && <p style={{ color: "#fbbf24", fontSize: "0.9rem" }}>Nincs szerverkapcsolat — előbb párosíts.</p>}
      {base && samples.length === 0 && <p style={{ color: theme.muted, fontSize: "0.9rem" }}>Minták betöltése…</p>}

      {base && probing && samples.length > 0 && (
        <div
          style={{
            background: "rgba(122,77,255,0.18)",
            border: `1px solid ${theme.accent}`,
            borderRadius: 12,
            padding: "0.7rem 1.1rem",
            margin: "0.4rem 0 1rem",
            fontSize: "0.95rem",
            fontWeight: 700,
            color: "#fff",
          }}
        >
          Videó / konténer / felirat tesztek futnak… ({autoDone}/{autoSamples.length}) — az audió ezután jön.
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const items = samples.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginTop: "1.1rem", marginBottom: "0.4rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>{CAT_LABEL[cat]}</div>
            {cat === "audio"
              ? items.map((s, i) => {
                  const focused = !probing && fRow === i;
                  const isPlaying = playingId === s.id;
                  const ans = answers[s.id] ?? null;
                  const av =
                    ans === "yes"
                      ? { text: "Van hang", color: "#4ade80" }
                      : ans === "no"
                        ? { text: "Nincs hang", color: "#f87171" }
                        : { text: "Hallgasd meg", color: theme.muted };
                  return (
                    <div
                      key={s.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(i, el);
                        else rowRefs.current.delete(i);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "0.55rem 0.8rem",
                        marginBottom: "0.45rem",
                        background: theme.surface,
                        border: focused ? "1px solid rgba(122,77,255,0.55)" : `1px solid ${theme.border}`,
                        borderRadius: theme.radius,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: theme.text }}>{s.label}</div>
                        <div style={{ fontSize: "0.72rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.mime}</div>
                      </div>
                      <div style={{ width: 110, textAlign: "right", marginRight: "0.9rem", fontSize: "0.88rem", fontWeight: 700, color: av.color }}>{av.text}</div>
                      <div style={playBtnStyle(focused && fCol === 0, isPlaying)}>
                        <Icon name={isPlaying ? "pause" : "play"} size={22} />
                      </div>
                      <div style={pillStyle(focused && fCol === 1, ans, "yes")}>Igen</div>
                      <div style={pillStyle(focused && fCol === 2, ans, "no")}>Nem</div>
                    </div>
                  );
                })
              : items.map((s) => <Row key={s.id} label={s.label} sub={s.mime} right={verdict(cat, results[s.id] ?? "pending")} />)}
          </div>
        );
      })}

      {samples.length > 0 && (
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(sendRow, el);
            else rowRefs.current.delete(sendRow);
          }}
          style={{ marginTop: "1.6rem" }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "0.85rem 2.2rem",
              borderRadius: theme.radius,
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#fff",
              background: sent === "ok" ? "#15803d" : theme.gradient,
              border: !probing && fRow === sendRow ? "2px solid #fff" : "2px solid transparent",
              boxShadow: !probing && fRow === sendRow ? "0 0 0 4px rgba(122,77,255,0.45)" : "none",
              opacity: sent === "sending" ? 0.7 : 1,
            }}
          >
            {sendLabel}
          </div>
          <div style={{ color: theme.muted, fontSize: "0.82rem", marginTop: "0.5rem" }}>
            Audió megválaszolva: {answered}/{audioSamples.length}
          </div>
        </div>
      )}

      <div style={{ color: theme.muted, fontSize: "0.78rem", marginTop: "1.2rem" }}>
        ▲▼ Sorok · ◀▶ Lejátszás / Igen / Nem · Enter aktivál · Back Vissza
      </div>
    </div>
  );
}
