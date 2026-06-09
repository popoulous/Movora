import React, { useCallback, useEffect, useRef, useState } from "react";
import { type PlaybackInfo, type Episode, type SeriesDetail, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import { aspectHeight } from "../util";

interface Props {
  episodeId: number;
  onBack: () => void;
  onNext: (id: number) => void;
}

type SkipZone = "intro" | "outro" | null;

const SAVE_INTERVAL_S = 10;
const COUNTDOWN_START = 10;
const EP_W = 220;
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
  const [controls, setControls] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [skip, setSkip] = useState<SkipZone>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [subIdx, setSubIdx] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [epFocus, setEpFocus] = useState(0);
  const [focusRow, setFocusRow] = useState(1); // 0 = scrubber, 1 = button row
  const [focusCol, setFocusCol] = useState(1); // index into the transport buttons

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const ctrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const nextEpisodeId = curIdx >= 0 && curIdx + 1 < flat.length ? flat[curIdx + 1].id : null;

  const showControls = useCallback(() => {
    setControls(true);
    if (ctrlTimer.current) clearTimeout(ctrlTimer.current);
    ctrlTimer.current = setTimeout(() => setControls(false), 3500);
  }, []);

  const flashToast = (text: string): void => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2000);
  };

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v || !info) return;
    setDur(v.duration);
    if (info.resume_position > 5) v.currentTime = info.resume_position;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = "disabled";
  }, [info]);

  const handleTimeUpdate = useCallback(() => {
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
  }, [api, episodeId, info]);

  const handleEnded = useCallback(() => {
    if (api && info) void api.recordWatch(episodeId, { watched: true });
    setEnded(true);
  }, [api, episodeId, info]);

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

  // Keep the focused episode card visible while navigating the panel.
  useEffect(() => {
    if (!panelOpen) return;
    const el = document.querySelector(`[data-ep-idx="${epFocus}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [panelOpen, epFocus]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v) v.currentTime += delta;
  }, []);

  const cycleSubtitle = useCallback(() => {
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
  }, [subIdx]);

  const openPanel = useCallback(() => {
    setEpFocus(curIdx >= 0 ? curIdx : 0);
    setPanelOpen(true);
  }, [curIdx]);

  const doSkip = useCallback(() => {
    const v = videoRef.current;
    if (!v || !info) return;
    if (skip === "intro" && info.intro_end != null) v.currentTime = info.intro_end;
    else if (skip === "outro" && nextEpisodeId !== null) onNext(nextEpisodeId);
  }, [info, skip, nextEpisodeId, onNext]);

  // Transport buttons (order matters: it's the ←/→ focus order in the bar).
  const BAR_COUNT = 5;
  const activateBarButton = useCallback(
    (col: number) => {
      if (col === 0) seekBy(-10);
      else if (col === 1) togglePlay();
      else if (col === 2) seekBy(10);
      else if (col === 3) cycleSubtitle();
      else if (col === 4) openPanel();
    },
    [seekBy, togglePlay, cycleSubtitle, openPanel],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      showControls();
      const isBack = e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack";

      if (panelOpen) {
        if (isBack || e.key === "ArrowUp") {
          e.preventDefault();
          setPanelOpen(false);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setEpFocus((i) => Math.min(i + 1, flat.length - 1));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setEpFocus((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const ep = flat[epFocus];
          if (ep) {
            if (ep.id === episodeId) setPanelOpen(false);
            else onNext(ep.id);
          }
        }
        return;
      }

      switch (e.key) {
        case "Escape":
        case "Backspace":
        case "GoBack":
          e.preventDefault();
          if (videoRef.current) {
            void api?.recordWatch(episodeId, { position_seconds: videoRef.current.currentTime });
          }
          onBack();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (ended && nextEpisodeId !== null) onNext(nextEpisodeId);
          else if (focusRow === 0) togglePlay();
          else activateBarButton(focusCol);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (focusRow === 0) seekBy(10);
          else setFocusCol((c) => Math.min(c + 1, BAR_COUNT - 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (focusRow === 0) seekBy(-10);
          else setFocusCol((c) => Math.max(c - 1, 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusRow(0); // up -> the scrubber
          break;
        case "ArrowDown":
          e.preventDefault();
          if (focusRow === 0) setFocusRow(1); // scrubber -> buttons
          else openPanel(); // from buttons -> episode panel
          break;
      }
    },
    [showControls, panelOpen, flat, epFocus, episodeId, onNext, api, onBack, ended, nextEpisodeId, togglePlay, seekBy, focusRow, focusCol, activateBarButton, openPanel],
  );

  const handleBarClick = (e: React.MouseEvent): void => {
    const bar = barRef.current;
    if (!bar || dur <= 0) return;
    const rect = bar.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    seekTo(frac * dur);
  };

  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, background: theme.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#f87171", gap: "1rem" }}>
        <p>Lejátszási hiba: {error}</p>
        <button className="spottable mv-focusable" onClick={onBack} style={pillStyle}>Vissza</button>
      </div>
    );
  }

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;
  const tracks = info?.subtitle_tracks ?? [];
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const fade = (visible: boolean): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transition: "opacity 0.35s",
    pointerEvents: visible ? "auto" : "none",
  });

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
          onClick={togglePlay}
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

      {/* Top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "1.2rem 2rem", background: "linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)", color: "#fff", fontWeight: 700, fontSize: "1.1rem", ...fade(controls || ended || panelOpen) }}>
        {info && (
          <span>{info.series_title} · {info.season_number}. évad · {info.episode_number}. rész{info.episode_title ? ` — ${info.episode_title}` : ""}</span>
        )}
      </div>

      {toast && (
        <div style={{ position: "absolute", top: "5rem", left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.8)", color: "#fff", padding: "0.5rem 1.2rem", borderRadius: 999, fontSize: "0.95rem" }}>{toast}</div>
      )}

      {/* Skip chip (clickable + ▲) */}
      {skip !== null && !ended && !panelOpen && (
        <button className="mv-focusable" onClick={doSkip} style={{ position: "absolute", right: "2.5rem", bottom: "9rem", background: theme.gradient, color: "#fff", border: "none", padding: "0.7rem 1.3rem", borderRadius: theme.radius, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", zIndex: 4, ...fade(true) }}>
          {skip === "intro" ? "Intro kihagyása ▶▶" : "Következő rész ▶▶"}
        </button>
      )}

      {/* Plex-style transport bar: scrubber + icon buttons (click + D-pad) */}
      {info && !panelOpen && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "3rem 3rem 1.8rem", background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)", ...fade(controls && !ended) }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", color: "#fff" }}>
            <span style={{ fontSize: "0.9rem", fontVariantNumeric: "tabular-nums", width: 64, textAlign: "right" }}>{fmt(cur)}</span>
            <div
              ref={barRef}
              onClick={handleBarClick}
              style={{
                flex: 1,
                height: 8,
                background: "rgba(255,255,255,0.22)",
                borderRadius: 999,
                cursor: "pointer",
                position: "relative",
                boxShadow: focusRow === 0 ? `0 0 0 3px ${theme.accent}` : "none",
              }}
            >
              <div style={{ width: `${pct}%`, height: "100%", background: theme.gradient, borderRadius: 999 }} />
              <div
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: focusRow === 0 ? 20 : 14,
                  height: focusRow === 0 ? 20 : 14,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 0 8px rgba(122,77,255,0.8)",
                }}
              />
            </div>
            <span style={{ fontSize: "0.9rem", fontVariantNumeric: "tabular-nums", width: 64 }}>{fmt(dur)}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.8rem", marginTop: "1.4rem" }}>
            {[
              { label: "↺ 10", title: "−10 mp" },
              { label: paused ? "▶" : "❚❚", title: paused ? "Lejátszás" : "Szünet" },
              { label: "10 ↻", title: "+10 mp" },
              { label: "CC", title: "Felirat" },
              { label: "≣ Részek", title: "Részek" },
            ].map((b, i) => {
              const active = focusRow === 1 && focusCol === i;
              const big = i === 1;
              return (
                <button
                  key={b.title}
                  title={b.title}
                  onClick={() => {
                    setFocusRow(1);
                    setFocusCol(i);
                    activateBarButton(i);
                  }}
                  style={{
                    minWidth: big ? 68 : 56,
                    height: big ? 68 : 56,
                    padding: "0 1rem",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: big ? "1.5rem" : "1.05rem",
                    fontWeight: 700,
                    color: "#fff",
                    background: active ? theme.gradient : "rgba(255,255,255,0.12)",
                    border: active ? "none" : "1px solid rgba(255,255,255,0.18)",
                    boxShadow: active ? "0 0 18px rgba(122,77,255,0.7)" : "none",
                    transform: active ? "scale(1.08)" : "none",
                    transition: "transform 0.12s ease, background 0.12s ease",
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Episode panel (▼) */}
      {info && panelOpen && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "1.5rem 2rem 2rem", background: "linear-gradient(to top, rgba(5,6,11,0.97), rgba(5,6,11,0.85))" }}>
          <div style={{ color: "#fff", fontWeight: 700, marginBottom: "0.9rem" }}>Részek</div>
          <div className="mv-row" style={{ display: "flex", overflowX: "auto", paddingBottom: "0.5rem" }}>
            {flat.map((ep, i) => {
              const focused = i === epFocus;
              const isCurrent = ep.id === episodeId;
              const thumb = mediaUrl(base, token, ep.thumbnail_url);
              const label = ep.end_number != null ? `${ep.number}–${ep.end_number}.` : `${ep.number}.`;
              return (
                <button
                  key={ep.id}
                  data-ep-idx={i}
                  onClick={() => (isCurrent ? setPanelOpen(false) : onNext(ep.id))}
                  style={{
                    width: EP_W,
                    flexShrink: 0,
                    marginRight: "0.8rem",
                    background: theme.surface,
                    border: `3px solid ${focused ? theme.accent : "transparent"}`,
                    borderRadius: theme.radius,
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
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
                  <div style={{ padding: "0.5rem 0.6rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                      {label} rész{isCurrent ? " ●" : ""}{ep.watched ? " ✓" : ""}
                    </div>
                    {ep.title && (
                      <div style={{ fontSize: "0.72rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.title}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "0.6rem", color: theme.muted, fontSize: "0.8rem" }}>◀▶ Lépkedés · Enter Lejátszás · ▲/Back Bezár</div>
        </div>
      )}

      {/* Ended overlay */}
      {ended && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(5,6,11,0.8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", gap: "1rem" }}>
          <p style={{ fontSize: "1.6rem", fontWeight: 800 }}>Epizód vége</p>
          <p style={{ color: theme.muted }}>
            {nextEpisodeId !== null ? `Következő rész ${countdown} mp múlva… (Enter)` : `Vissza ${countdown} mp múlva…`}
          </p>
          <button className="mv-focusable" onClick={() => (nextEpisodeId !== null ? onNext(nextEpisodeId) : onBack())} style={{ ...pillStyle, background: theme.gradient, border: "none" }}>
            {nextEpisodeId !== null ? "Következő rész ▶" : "Vissza"}
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
