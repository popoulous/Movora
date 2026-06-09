import React, { useEffect, useRef, useState } from "react";
import { type PlaybackInfo, type Episode, type SeriesDetail, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import { aspectHeight } from "../util";
import { Icon } from "../components/Icon";

interface Props {
  episodeId: number;
  onBack: () => void;
  onNext: (id: number) => void;
}

type SkipZone = "intro" | "outro" | null;
type Row = "scrub" | "controls" | "episodes";

const SAVE_INTERVAL_S = 10;
const COUNTDOWN_START = 10;
const PANEL_TIMEOUT = 6000;
const EP_W = 200;
const EP_H = aspectHeight(EP_W, "16/9");

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}

export default function PlayerView({ episodeId, onBack, onNext }: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [skip, setSkip] = useState<SkipZone>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [subIdx, setSubIdx] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [row, setRow] = useState<Row>("controls");
  const [col, setCol] = useState(3); // default: play/pause
  const [epFocus, setEpFocus] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = config?.serverUrl ?? "";
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) return;
    api
      .getPlayback(episodeId)
      .then((i) => {
        setInfo(i);
        setError(null);
        setEnded(false);
        setSkip(null);
        setCountdown(COUNTDOWN_START);
        setSubIdx(-1);
        setPanelOpen(false);
        lastSaved.current = 0;
        api.getSeries(i.series_id).then(setSeries).catch(() => undefined);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, episodeId]);

  const flat: Episode[] = series ? series.seasons.flatMap((s) => s.episodes) : [];
  const curIdx = flat.findIndex((e) => e.id === episodeId);
  const prevEpisodeId = curIdx > 0 ? flat[curIdx - 1].id : null;
  const nextEpisodeId = curIdx >= 0 && curIdx + 1 < flat.length ? flat[curIdx + 1].id : null;

  const flashToast = (text: string): void => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2000);
  };

  const handleLoadedMetadata = (): void => {
    const v = videoRef.current;
    if (!v || !info) return;
    setDur(v.duration);
    if (info.resume_position > 5) v.currentTime = info.resume_position;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = "disabled";
  };

  const handleTimeUpdate = (): void => {
    const v = videoRef.current;
    if (!v || !info || !api) return;
    const t = v.currentTime;
    setCur(t);
    if (info.intro_start != null && info.intro_end != null && t >= info.intro_start && t < info.intro_end) {
      setSkip("intro");
    } else if (info.outro_start != null && t >= info.outro_start) {
      setSkip("outro");
    } else {
      setSkip(null);
    }
    if (t - lastSaved.current >= SAVE_INTERVAL_S) {
      lastSaved.current = t;
      void api.recordWatch(episodeId, { position_seconds: t });
    }
  };

  const handleEnded = (): void => {
    if (api && info) void api.recordWatch(episodeId, { watched: true });
    setEnded(true);
  };

  useEffect(() => {
    if (!ended) {
      if (cdTimer.current) clearInterval(cdTimer.current);
      return;
    }
    cdTimer.current = setInterval(() => setCountdown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => {
      if (cdTimer.current) clearInterval(cdTimer.current);
    };
  }, [ended]);

  useEffect(() => {
    if (countdown === 0) {
      if (nextEpisodeId !== null) onNext(nextEpisodeId);
      else onBack();
    }
  }, [countdown, nextEpisodeId, onBack, onNext]);

  useEffect(() => {
    if (info) rootRef.current?.focus();
  }, [info]);

  // Keep the focused episode card visible.
  useEffect(() => {
    if (!panelOpen || row !== "episodes") return;
    const el = document.querySelector(`[data-ep-idx="${epFocus}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [panelOpen, row, epFocus]);

  const armPanelTimer = (): void => {
    if (panelTimer.current) clearTimeout(panelTimer.current);
    panelTimer.current = setTimeout(() => setPanelOpen(false), PANEL_TIMEOUT);
  };

  const openPanel = (): void => {
    setRow("controls");
    setCol(3);
    setEpFocus(curIdx >= 0 ? curIdx : 0);
    setPanelOpen(true);
    armPanelTimer();
  };

  const closePanel = (): void => {
    if (panelTimer.current) clearTimeout(panelTimer.current);
    setPanelOpen(false);
  };

  const togglePlay = (): void => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seekTo = (t: number): void => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  };

  const seekBy = (d: number): void => {
    const v = videoRef.current;
    if (v) v.currentTime += d;
  };

  const cycleSubtitle = (): void => {
    const v = videoRef.current;
    if (!v) return;
    const n = v.textTracks.length;
    if (n === 0) {
      flashToast("Nincs felirat");
      return;
    }
    const next = subIdx + 1 >= n ? -1 : subIdx + 1;
    for (let i = 0; i < n; i++) v.textTracks[i].mode = i === next ? "showing" : "disabled";
    setSubIdx(next);
    flashToast(next === -1 ? "Felirat: ki" : `Felirat: ${v.textTracks[next].label || `#${next + 1}`}`);
  };

  const doSkip = (): void => {
    const v = videoRef.current;
    if (!v || !info) return;
    if (skip === "intro" && info.intro_end != null) v.currentTime = info.intro_end;
    else if (skip === "outro" && nextEpisodeId !== null) onNext(nextEpisodeId);
  };

  const runControl = (id: string): void => {
    if (id === "sub") cycleSubtitle();
    else if (id === "prev") {
      if (prevEpisodeId !== null) onNext(prevEpisodeId);
    } else if (id === "rew") seekBy(-10);
    else if (id === "play") togglePlay();
    else if (id === "fwd") seekBy(10);
    else if (id === "next") {
      if (nextEpisodeId !== null) onNext(nextEpisodeId);
    } else if (id === "skip") doSkip();
  };

  // The transport buttons, in ←/→ focus order. Skip appears only inside its window.
  type Ctrl = { id: string; icon: string; big?: boolean; on?: boolean };
  const controls: Ctrl[] = [
    { id: "sub", icon: "subtitles", on: subIdx >= 0 },
    { id: "prev", icon: "prev" },
    { id: "rew", icon: "rewind" },
    { id: "play", icon: paused ? "play" : "pause", big: true },
    { id: "fwd", icon: "forward" },
    { id: "next", icon: "next" },
    ...(skip !== null ? [{ id: "skip", icon: "skip" }] : []),
  ];

  const playEpisode = (ep: Episode | undefined): void => {
    if (!ep) return;
    if (ep.id === episodeId) closePanel();
    else onNext(ep.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const k = e.key;
    // webOS remote Back is keyCode 461 (and may not surface a useful e.key).
    const isBack = k === "Escape" || k === "Backspace" || k === "GoBack" || e.keyCode === 461;

    if (!panelOpen) {
      if (isBack) {
        e.preventDefault();
        if (videoRef.current) void api?.recordWatch(episodeId, { position_seconds: videoRef.current.currentTime });
        onBack();
      } else if (k === "Enter" || k === " ") {
        e.preventDefault();
        if (ended && nextEpisodeId !== null) onNext(nextEpisodeId);
        else togglePlay();
      } else if (k === "ArrowLeft") {
        seekBy(-10);
      } else if (k === "ArrowRight") {
        seekBy(10);
      } else if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        openPanel();
      }
      return;
    }

    // Panel open
    armPanelTimer();
    if (isBack) {
      e.preventDefault();
      closePanel();
      return;
    }
    if (k === "ArrowUp") {
      e.preventDefault();
      if (row === "episodes") setRow("controls");
      else if (row === "controls") setRow("scrub");
      else closePanel(); // up from the scrubber closes
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      if (row === "scrub") setRow("controls");
      else if (row === "controls") setRow("episodes");
      return;
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      if (row === "scrub") seekBy(-10);
      else if (row === "controls") setCol((c) => Math.max(0, c - 1));
      else setEpFocus((i) => Math.max(0, i - 1));
      return;
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      if (row === "scrub") seekBy(10);
      else if (row === "controls") setCol((c) => Math.min(controls.length - 1, c + 1));
      else setEpFocus((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (row === "scrub") togglePlay();
      else if (row === "controls") {
        const c = controls[Math.min(col, controls.length - 1)];
        if (c) runControl(c.id);
      } else playEpisode(flat[epFocus]);
    }
  };

  const handleBarClick = (e: React.MouseEvent): void => {
    const bar = barRef.current;
    if (!bar || dur <= 0) return;
    const rect = bar.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * dur);
  };

  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, background: theme.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#f87171", gap: "1rem" }}>
        <p>Lejátszási hiba: {error}</p>
        <button onClick={onBack} style={pillStyle}>Vissza</button>
      </div>
    );
  }

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;
  const tracks = info?.subtitle_tracks ?? [];
  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={handleKeyDown} style={{ position: "fixed", inset: 0, background: "#000", outline: "none" }}>
      {!info && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted }}>Betöltés…</div>
      )}

      {info && (
        <video
          ref={videoRef}
          src={streamUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          autoPlay
          onClick={() => (panelOpen ? closePanel() : togglePlay())}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        >
          {tracks.map((tr) => {
            const url = tr.format === "ass" ? `${tr.url}?as=vtt` : tr.url;
            return <track key={tr.id} kind="subtitles" label={tr.label} src={mediaUrl(base, token, url)} srcLang={tr.language ?? undefined} />;
          })}
        </video>
      )}

      {toast && (
        <div style={{ position: "absolute", top: "2.5rem", left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", color: "#fff", padding: "0.5rem 1.3rem", borderRadius: 999, fontSize: "1rem" }}>{toast}</div>
      )}

      {/* Skip chip on the video (when the panel is closed) */}
      {skip !== null && !ended && !panelOpen && (
        <div onClick={doSkip} style={{ position: "absolute", right: "3rem", bottom: "3rem", display: "flex", alignItems: "center", gap: "0.5rem", background: theme.gradient, color: "#fff", padding: "0.7rem 1.3rem", borderRadius: theme.radius, fontWeight: 700, cursor: "pointer" }}>
          <Icon name="skip" size={18} />
          {skip === "intro" ? "Intro kihagyása" : "Következő rész"}
        </div>
      )}

      {/* Bottom panel (▼) — Plex-style */}
      {info && panelOpen && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "1.6rem 3rem 1.8rem",
            background: "linear-gradient(to top, rgba(5,6,11,0.97) 30%, rgba(5,6,11,0.6) 80%, transparent)",
          }}
        >
          {/* Title + meta */}
          <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff" }}>{info.series_title}</div>
            <div style={{ fontSize: "0.95rem", color: theme.muted, marginTop: 2 }}>
              {info.season_number}. évad · {info.episode_number}. rész
              {info.episode_title ? ` — ${info.episode_title}` : ""}
            </div>
          </div>

          {/* Scrubber */}
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", color: "#fff", marginBottom: "1.2rem" }}>
            <span style={{ fontSize: "0.9rem", fontVariantNumeric: "tabular-nums", width: 60, textAlign: "right" }}>{fmt(cur)}</span>
            <div
              ref={barRef}
              onClick={handleBarClick}
              style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.22)", borderRadius: 999, cursor: "pointer", position: "relative", boxShadow: row === "scrub" ? `0 0 0 3px ${theme.accent}` : "none" }}
            >
              <div style={{ width: `${pct}%`, height: "100%", background: theme.gradient, borderRadius: 999 }} />
              <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%,-50%)", width: row === "scrub" ? 20 : 14, height: row === "scrub" ? 20 : 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(122,77,255,0.8)" }} />
            </div>
            <span style={{ fontSize: "0.9rem", fontVariantNumeric: "tabular-nums", width: 60 }}>{fmt(dur)}</span>
          </div>

          {/* Transport controls */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.9rem", marginBottom: "1.3rem" }}>
            {controls.map((c, i) => {
              const active = row === "controls" && Math.min(col, controls.length - 1) === i;
              const size = c.big ? 64 : 50;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setRow("controls");
                    setCol(i);
                    runControl(c.id);
                    armPanelTimer();
                  }}
                  style={{
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: active ? "#fff" : c.on ? theme.accent : "#e8e8f0",
                    background: active ? theme.gradient : "rgba(255,255,255,0.1)",
                    border: active ? "none" : "1px solid rgba(255,255,255,0.16)",
                    boxShadow: active ? "0 0 20px rgba(122,77,255,0.7)" : "none",
                    transform: active ? "scale(1.06)" : "none",
                    transition: "transform 0.12s ease, background 0.12s ease",
                  }}
                >
                  <Icon name={c.icon} size={c.big ? 30 : 22} />
                </div>
              );
            })}
          </div>

          {/* Episode strip */}
          <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fff", marginBottom: "0.6rem" }}>Részek</div>
          <div className="mv-row" style={{ display: "flex", overflowX: "auto", paddingBottom: "0.3rem" }}>
            {flat.map((ep, i) => {
              const focused = row === "episodes" && i === epFocus;
              const isCurrent = ep.id === episodeId;
              const thumb = mediaUrl(base, token, ep.thumbnail_url);
              const label = ep.end_number != null ? `${ep.number}–${ep.end_number}.` : `${ep.number}.`;
              return (
                <div
                  key={ep.id}
                  data-ep-idx={i}
                  onClick={() => {
                    setRow("episodes");
                    setEpFocus(i);
                    playEpisode(ep);
                  }}
                  style={{
                    width: EP_W,
                    flexShrink: 0,
                    marginRight: "0.8rem",
                    background: theme.surface,
                    border: `3px solid ${focused ? theme.accent : isCurrent ? "rgba(122,77,255,0.5)" : "transparent"}`,
                    borderRadius: theme.radius,
                    cursor: "pointer",
                    color: ep.watched ? theme.muted : theme.text,
                    overflow: "hidden",
                    boxShadow: focused ? "0 0 16px rgba(122,77,255,0.6)" : "none",
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: "100%", height: EP_H, objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: EP_H, background: "#11131f" }} />
                  )}
                  <div style={{ padding: "0.45rem 0.6rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                      {label} rész{isCurrent ? " ●" : ""}{ep.watched ? " ✓" : ""}
                    </div>
                    {ep.title && (
                      <div style={{ fontSize: "0.7rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.title}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ended overlay */}
      {ended && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(5,6,11,0.82)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", gap: "1rem" }}>
          <p style={{ fontSize: "1.6rem", fontWeight: 800 }}>Epizód vége</p>
          <p style={{ color: theme.muted }}>
            {nextEpisodeId !== null ? `Következő rész ${countdown} mp múlva… (Enter)` : `Vissza ${countdown} mp múlva…`}
          </p>
          <button onClick={() => (nextEpisodeId !== null ? onNext(nextEpisodeId) : onBack())} style={{ ...pillStyle, background: theme.gradient, border: "none" }}>
            {nextEpisodeId !== null ? "Következő rész" : "Vissza"}
          </button>
        </div>
      )}
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 999,
  color: "#fff",
  padding: "0.6rem 1.5rem",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "1rem",
};
