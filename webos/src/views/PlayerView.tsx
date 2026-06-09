import React, { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@enact/sandstone/Spinner";
import { type PlaybackInfo, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";

interface Props {
  episodeId: number;
  onBack: () => void;
  onNext: (id: number) => void;
}

type SkipZone = "intro" | "outro" | null;

const SAVE_INTERVAL_S = 10;
const NEAR_END_S = 90;
const COUNTDOWN_START = 10;

export default function PlayerView({ episodeId, onBack }: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlsActive, setControlsActive] = useState(true);
  const [skip, setSkip] = useState<SkipZone>(null);
  const [nearEnd, setNearEnd] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!api) return;
    api
      .getPlayback(episodeId)
      .then((i) => {
        setInfo(i);
        setError(null);
        setEnded(false);
        setNearEnd(false);
        setSkip(null);
        setCountdown(COUNTDOWN_START);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, episodeId]);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current && info && info.resume_position > 5) {
      videoRef.current.currentTime = info.resume_position;
    }
  }, [info]);

  const showControls = useCallback(() => {
    setControlsActive(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsActive(false), 3000);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !info || !api) return;
    const t = videoRef.current.currentTime;
    const dur = videoRef.current.duration;

    if (info.intro_start !== null && info.intro_end !== null && t >= info.intro_start && t < info.intro_end) {
      setSkip("intro");
    } else if (info.outro_start !== null && t >= info.outro_start) {
      setSkip("outro");
    } else {
      setSkip(null);
    }

    if (!isNaN(dur) && dur - t < NEAR_END_S) setNearEnd(true);

    if (t - lastSavedRef.current >= SAVE_INTERVAL_S) {
      lastSavedRef.current = t;
      void api.recordWatch(episodeId, { position_seconds: t });
    }
  }, [api, episodeId, info]);

  const doSkip = useCallback(() => {
    if (!videoRef.current || !info) return;
    if (skip === "intro" && info.intro_end !== null) {
      videoRef.current.currentTime = info.intro_end;
    } else if (skip === "outro") {
      videoRef.current.currentTime = videoRef.current.duration;
    }
  }, [info, skip]);

  const handleEnded = useCallback(() => {
    if (info && api) {
      void api.recordWatch(episodeId, { watched: true });
    }
    setEnded(true);
  }, [api, episodeId, info]);

  useEffect(() => {
    if (!ended) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [ended]);

  useEffect(() => {
    if (countdown === 0) onBack();
  }, [countdown, onBack]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      showControls();
      switch (e.key) {
        case "Escape":
        case "Backspace":
        case "GoBack":
          e.preventDefault();
          if (videoRef.current && !videoRef.current.paused) {
            void api?.recordWatch(episodeId, { position_seconds: videoRef.current.currentTime });
          }
          onBack();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (videoRef.current) {
            if (videoRef.current.paused) void videoRef.current.play();
            else videoRef.current.pause();
          }
          break;
        case "ArrowRight":
          if (videoRef.current) videoRef.current.currentTime += 10;
          break;
        case "ArrowLeft":
          if (videoRef.current) videoRef.current.currentTime -= 10;
          break;
      }
    },
    [api, episodeId, onBack, showControls],
  );

  if (error) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#05060B",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#f87171",
        }}
      >
        <p>Lejátszási hiba: {error}</p>
        <button
          onClick={onBack}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1.5rem",
            background: "#c084fc",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Vissza
        </button>
      </div>
    );
  }

  const base = config?.serverUrl ?? "";
  const token = config?.deviceToken ?? null;
  // <video>/<track> can't send the bearer header — carry the token as ?token=.
  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;
  const vttTracks = info?.subtitle_tracks.filter((t) => t.format === "vtt") ?? [];

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={showControls}
      style={{ position: "fixed", inset: 0, background: "#000", outline: "none" }}
    >
      {!info && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner component="div" />
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
        >
          {vttTracks.map((tr) => (
            <track
              key={tr.id}
              kind="subtitles"
              label={tr.label}
              src={mediaUrl(base, token, tr.url)}
              srcLang={tr.language ?? undefined}
            />
          ))}
        </video>
      )}

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "1rem 1.5rem",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          opacity: controlsActive ? 1 : 0,
          transition: "opacity 0.4s",
          pointerEvents: controlsActive ? "auto" : "none",
        }}
      >
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.2rem", cursor: "pointer" }}
        >
          ←
        </button>
        {info && (
          <span style={{ color: "#fff", fontWeight: 600 }}>
            {info.series_title} · {info.season_number}. évad · {info.episode_number}. rész
            {info.episode_title ? ` — ${info.episode_title}` : ""}
          </span>
        )}
      </div>

      {/* Skip chip */}
      {skip !== null && !ended && (
        <button
          onClick={doSkip}
          style={{
            position: "absolute",
            right: "2rem",
            bottom: "6rem",
            padding: "0.6rem 1.2rem",
            background: "rgba(192,132,252,0.9)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {skip === "intro" ? "Intro kihagyása ▶" : "Outro kihagyása ▶"}
        </button>
      )}

      {nearEnd && !ended && skip === null && (
        <div
          style={{
            position: "absolute",
            right: "2rem",
            bottom: "6rem",
            padding: "0.6rem 1rem",
            background: "rgba(0,0,0,0.7)",
            borderRadius: 6,
            color: "#d4d4f0",
            fontSize: "0.85rem",
          }}
        >
          Közeleg a vége…
        </div>
      )}

      {/* Ended overlay */}
      {ended && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          <p style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Epizód vége</p>
          <p style={{ opacity: 0.7, marginBottom: "2rem" }}>
            Visszatérés {countdown} másodpercen belül…
          </p>
          <button
            onClick={onBack}
            style={{
              padding: "0.6rem 1.5rem",
              background: "#c084fc",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Vissza a sorozathoz
          </button>
        </div>
      )}
    </div>
  );
}
