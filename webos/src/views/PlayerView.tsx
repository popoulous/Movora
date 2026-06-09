import React, { useCallback, useEffect, useRef, useState } from "react";
import { type PlaybackInfo, type SeriesDetail, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";

interface Props {
  episodeId: number;
  onBack: () => void;
  onNext: (id: number) => void;
}

type SkipZone = "intro" | "outro" | null;

const SAVE_INTERVAL_S = 10;
const NEAR_END_S = 90;
const COUNTDOWN_START = 10;

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
  const [subIdx, setSubIdx] = useState(-1); // -1 = off
  const [toast, setToast] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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
        lastSaved.current = 0;
        api.getSeries(i.series_id).then(setSeries).catch(() => undefined);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, episodeId]);

  // The next episode in series order (for auto-advance + the "next" actions).
  const flat = series ? series.seasons.flatMap((s) => s.episodes) : [];
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
    if (
      info.intro_start != null &&
      info.intro_end != null &&
      t >= info.intro_start &&
      t < info.intro_end
    ) {
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

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
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

  const doSkip = useCallback(() => {
    const v = videoRef.current;
    if (!v || !info) return;
    if (skip === "intro" && info.intro_end != null) {
      v.currentTime = info.intro_end;
    } else if (skip === "outro") {
      if (nextEpisodeId !== null) onNext(nextEpisodeId);
      else v.currentTime = v.duration;
    }
  }, [info, skip, nextEpisodeId, onNext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      showControls();
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
          else togglePlay();
          break;
        case "ArrowRight":
          if (videoRef.current) videoRef.current.currentTime += 10;
          break;
        case "ArrowLeft":
          if (videoRef.current) videoRef.current.currentTime -= 10;
          break;
        case "ArrowUp":
          e.preventDefault();
          cycleSubtitle();
          break;
        case "ArrowDown":
          e.preventDefault();
          if (skip !== null) doSkip();
          else if (nextEpisodeId !== null && dur - cur < NEAR_END_S) onNext(nextEpisodeId);
          break;
      }
    },
    [api, episodeId, onBack, onNext, ended, nextEpisodeId, togglePlay, cycleSubtitle, skip, doSkip, dur, cur, showControls],
  );

  if (error) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: theme.bg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#f87171",
          gap: "1rem",
        }}
      >
        <p>Lejátszási hiba: {error}</p>
        <button className="spottable mv-focusable" onClick={onBack} style={pillStyle}>
          Vissza
        </button>
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
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ position: "fixed", inset: 0, background: "#000", outline: "none" }}
    >
      {!info && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted }}>
          Betöltés…
        </div>
      )}

      {info && (
        <video
          ref={videoRef}
          src={streamUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          autoPlay
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        >
          {tracks.map((tr) => {
            const url = tr.format === "ass" ? `${tr.url}?as=vtt` : tr.url;
            return (
              <track
                key={tr.id}
                kind="subtitles"
                label={tr.label}
                src={mediaUrl(base, token, url)}
                srcLang={tr.language ?? undefined}
              />
            );
          })}
        </video>
      )}

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "1.2rem 2rem",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)",
          color: "#fff",
          fontWeight: 700,
          fontSize: "1.1rem",
          ...fade(controls || ended),
        }}
      >
        {info && (
          <span>
            {info.series_title} · {info.season_number}. évad · {info.episode_number}. rész
            {info.episode_title ? ` — ${info.episode_title}` : ""}
          </span>
        )}
      </div>

      {/* Subtitle toast */}
      {toast && (
        <div
          style={{
            position: "absolute",
            top: "5rem",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.8)",
            color: "#fff",
            padding: "0.5rem 1.2rem",
            borderRadius: 999,
            fontSize: "0.95rem",
          }}
        >
          {toast}
        </div>
      )}

      {/* Skip / next chip */}
      {skip !== null && !ended && (
        <div
          style={{
            position: "absolute",
            right: "2.5rem",
            bottom: "7rem",
            background: theme.gradient,
            color: "#fff",
            padding: "0.6rem 1.2rem",
            borderRadius: theme.radius,
            fontWeight: 700,
            fontSize: "0.95rem",
          }}
        >
          {skip === "intro" ? "Intro kihagyása ▼" : "Stáblista — következő rész ▼"}
        </div>
      )}

      {/* Bottom controls: seek bar + key hints */}
      {info && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "2.5rem 2.5rem 1.5rem",
            background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
            ...fade(controls && !ended),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", color: "#fff" }}>
            <span style={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>{fmt(cur)}</span>
            <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.25)", borderRadius: 999 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: theme.gradient, borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>{fmt(dur)}</span>
          </div>
          <div style={{ marginTop: "0.8rem", color: theme.muted, fontSize: "0.8rem", display: "flex", gap: "1.5rem" }}>
            <span>{paused ? "▶ Enter" : "⏸ Enter"}</span>
            <span>◀▶ ±10 mp</span>
            <span>▲ Felirat</span>
            <span>▼ {skip !== null ? "Kihagyás" : "Következő"}</span>
          </div>
        </div>
      )}

      {/* Ended overlay */}
      {ended && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(5,6,11,0.8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            gap: "1rem",
          }}
        >
          <p style={{ fontSize: "1.6rem", fontWeight: 800 }}>Epizód vége</p>
          <p style={{ color: theme.muted }}>
            {nextEpisodeId !== null
              ? `Következő rész ${countdown} mp múlva… (Enter)`
              : `Vissza ${countdown} mp múlva…`}
          </p>
          <button
            className="spottable mv-focusable"
            onClick={() => (nextEpisodeId !== null ? onNext(nextEpisodeId) : onBack())}
            style={{ ...pillStyle, background: theme.gradient, border: "none" }}
          >
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
