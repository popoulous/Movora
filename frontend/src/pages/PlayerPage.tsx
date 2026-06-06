import JASSUB from "jassub";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type PlaybackInfo } from "../api";

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition ${
    active
      ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
      : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
  }`;
}

export function PlayerPage(): JSX.Element {
  const { t } = useTranslation();
  const { refreshSoon } = useActivity();
  const { episodeId } = useParams();
  const id = Number(episodeId);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);

  useEffect(() => {
    setPlayback(null);
    setError(null);
    setTrackId(null);
    setNormalizing(false);
    api
      .getPlayback(id)
      .then(setPlayback)
      .catch((reason: unknown) => setError(String(reason)));
  }, [id]);

  const normalize = (): void => {
    setNormalizing(true);
    api.normalizeEpisode(id).catch(() => undefined);
    refreshSoon(); // surface the spinner next to the bell immediately
  };

  // While optimizing, poll until the normalized mp4 is ready, then swap it in.
  useEffect(() => {
    if (!normalizing) return;
    const timer = setInterval(() => {
      api
        .getPlayback(id)
        .then((info) => {
          if (info.direct_play) {
            setPlayback(info);
            setNormalizing(false);
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [normalizing, id]);

  // Soft ASS is rendered by JASSUB as a canvas overlay; the instance is recreated
  // on track change and destroyed on cleanup. VTT tracks use a native <track>.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playback === null) {
      return;
    }
    const selected = playback.subtitle_tracks.find((track) => track.id === trackId);
    if (selected === undefined || selected.format !== "ass") {
      return;
    }
    let instance: JASSUB | null = null;
    let cancelled = false;
    void fetch(selected.url)
      .then((response) => response.text())
      .then((subContent) => {
        const current = videoRef.current;
        if (cancelled || current === null) {
          return;
        }
        // NOTE: fonts embedded in the source .mkv aren't served yet, and jassub 2.5.5
        // ships no bundled fallback font, so libass falls back to local fonts. Proper
        // font handling (bundled fallback + mkv attachment extraction) is a follow-up.
        instance = new JASSUB({ video: current, subContent });
      });
    return () => {
      cancelled = true;
      void instance?.destroy();
    };
  }, [playback, trackId]);

  if (error !== null) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (playback === null) {
    return <p className="text-sm text-neutral-500">{t("player.loading")}</p>;
  }

  const vttTrack =
    playback.subtitle_tracks.find(
      (track) => track.id === trackId && track.format === "vtt",
    ) ?? null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="text-sm text-neutral-400 transition hover:text-white"
      >
        ◂ {t("player.back")}
      </button>

      {!playback.direct_play && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="min-w-0 flex-1">{t("player.notPlayable")}</span>
          <button
            onClick={normalize}
            disabled={normalizing}
            className="shrink-0 rounded-lg bg-amber-400/20 px-3 py-1.5 font-medium text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/30 disabled:opacity-60"
          >
            {normalizing ? t("player.normalizing") : t("player.normalizeNow")}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        <video
          key={String(playback.direct_play)}
          ref={videoRef}
          src={playback.stream_url}
          controls
          autoPlay
          className="aspect-video w-full"
        >
          {vttTrack !== null && (
            <track
              key={vttTrack.id}
              kind="subtitles"
              src={vttTrack.url}
              srcLang={vttTrack.language ?? undefined}
              label={vttTrack.label}
              default
            />
          )}
        </video>
      </div>

      {playback.subtitle_tracks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-400">{t("player.subtitles")}:</span>
          <button onClick={() => setTrackId(null)} className={chipClass(trackId === null)}>
            {t("player.subtitlesOff")}
          </button>
          {playback.subtitle_tracks.map((track) => (
            <button
              key={track.id}
              onClick={() => setTrackId(track.id)}
              className={chipClass(trackId === track.id)}
            >
              {track.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
