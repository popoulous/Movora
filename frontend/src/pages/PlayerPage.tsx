import fallbackFontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url";
// The latin subset lacks Latin Extended-A (ő, ű …); load the latin-ext face too so
// libass can fall back to it for Hungarian glyphs instead of drawing tofu boxes.
import fallbackFontExtUrl from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2?url";
import { type TFunction } from "i18next";
import JASSUB from "jassub";
import { Check, ChevronLeft, Play, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import {
  api,
  type Episode,
  type PlaybackInfo,
  type SeriesDetail,
  type SubtitleTrack,
} from "../api";

const LANG_NAMES: Record<string, string> = {
  hu: "Magyar",
  hun: "Magyar",
  en: "English",
  eng: "English",
  ja: "日本語",
  jpn: "日本語",
  de: "Deutsch",
  ger: "Deutsch",
  fr: "Français",
  fre: "Français",
};

function subtitleLabel(track: SubtitleTrack): string {
  const lang = track.language?.toLowerCase();
  if (lang !== undefined && lang.length > 0) return LANG_NAMES[lang] ?? lang.toUpperCase();
  return track.label;
}

// 2- and 3-letter codes that count as the same language, so we can match the UI locale.
const LANG_ALIASES: Record<string, string[]> = {
  hu: ["hu", "hun"],
  en: ["en", "eng"],
  ja: ["ja", "jpn", "jp"],
  de: ["de", "ger", "deu"],
  fr: ["fr", "fre", "fra"],
};

// Pick the subtitle in the user's language (UI locale, which defaults from the device);
// fall back to the first track so something always shows.
function pickDefaultTrack(tracks: SubtitleTrack[], uiLang: string): SubtitleTrack | null {
  const code = uiLang.slice(0, 2).toLowerCase();
  const codes = LANG_ALIASES[code] ?? [code];
  const preferred = tracks.find(
    (track) => track.language !== null && codes.includes(track.language.toLowerCase()),
  );
  return preferred ?? tracks[0] ?? null;
}

function seasonOrder(number: number): number {
  return number === 0 ? Number.MAX_SAFE_INTEGER : number;
}

function episodeLabel(episode: Episode): string {
  return episode.end_number !== null
    ? `${episode.number}–${episode.end_number}`
    : String(episode.number);
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition ${
    active
      ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
      : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
  }`;
}

export function PlayerPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { refreshSoon } = useActivity();
  const { episodeId } = useParams();
  const id = Number(episodeId);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0); // last position (s) we sent, to throttle progress writes
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    setPlayback(null);
    setSeries(null);
    setError(null);
    setTrackId(null);
    setNormalizing(false);
    setEnded(false);
    setCountdown(10);
    lastSaved.current = 0;
    api
      .getPlayback(id)
      .then((info) => {
        setPlayback(info);
        // Show a subtitle by default, preferring the user's language (UI locale / device).
        setTrackId(pickDefaultTrack(info.subtitle_tracks, i18n.language)?.id ?? null);
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, [id]);

  // Pull the series so we can show the episode list and the next episode.
  const seriesId = playback?.series_id;
  useEffect(() => {
    if (seriesId === undefined) return;
    api.getSeries(seriesId).then(setSeries).catch(() => undefined);
  }, [seriesId]);

  const ordered = useMemo(
    () =>
      series === null
        ? []
        : [...series.seasons]
            .sort((a, b) => seasonOrder(a.number) - seasonOrder(b.number))
            .flatMap((season) => [...season.episodes].sort((a, b) => a.number - b.number)),
    [series],
  );
  const currentIndex = ordered.findIndex((episode) => episode.id === id);
  const nextEpisode = currentIndex >= 0 ? (ordered[currentIndex + 1] ?? null) : null;
  const isSeries = ordered.length > 1;

  // Record watch progress: throttled position on play, watched on end, resume on load.
  const saveProgress = (): void => {
    const video = videoRef.current;
    if (video === null || video.currentTime - lastSaved.current < 10) return;
    lastSaved.current = video.currentTime;
    void api.recordWatch(id, { position_seconds: video.currentTime }).catch(() => undefined);
  };
  const markWatched = (): void => {
    void api.recordWatch(id, { watched: true }).catch(() => undefined);
    setEnded(true);
  };
  const resume = (): void => {
    const video = videoRef.current;
    if (video !== null && playback !== null && playback.resume_position > 0) {
      video.currentTime = playback.resume_position;
    }
  };

  // After the episode ends, count down and auto-advance to the next one.
  useEffect(() => {
    if (!ended || nextEpisode === null) return;
    if (countdown <= 0) {
      navigate(`/watch/${nextEpisode.id}`);
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [ended, countdown, nextEpisode, navigate]);

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
        instance = new JASSUB({
          video: current,
          subContent,
          // Embedded mkv fonts, plus the Noto Sans latin-ext face for Hungarian glyphs.
          fonts: [...playback.fonts, fallbackFontExtUrl],
          availableFonts: { "noto sans": fallbackFontUrl },
          defaultFont: "noto sans", // used when the .ass font isn't embedded
          // The browser local-font query sends an uncloneable callback to the worker
          // (JASSUB DataCloneError) and isn't needed once we ship a fallback font.
          queryFonts: false,
        });
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

  const seasonPart =
    playback.season_number === 0
      ? t("series.season0")
      : t("series.season", { number: playback.season_number });
  const epLabel =
    playback.episode_end_number !== null
      ? `${playback.episode_number}–${playback.episode_end_number}`
      : String(playback.episode_number);
  const artwork = playback.banner_image_url ?? playback.cover_image_url;

  return (
    <div className="relative">
      {artwork !== null && (
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center opacity-[0.12] blur-2xl"
          style={{ backgroundImage: `url(${artwork})` }}
        />
      )}

      {/* Breadcrumb: back to the series, then season · episode (no series rating here) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-400">
        <button
          onClick={() => navigate(`/series/${playback.series_id}`)}
          className="-ml-1 inline-flex items-center gap-0.5 font-medium text-neutral-300 transition hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          {playback.series_title}
        </button>
        {isSeries && (
          <>
            <span className="text-neutral-600">·</span>
            <span className="text-violet-300">{seasonPart}</span>
            <span className="text-neutral-600">·</span>
            <span>{t("series.episode", { number: epLabel })}</span>
          </>
        )}
      </div>
      <h1 className="mt-1 text-xl font-bold tracking-tight">
        {playback.episode_title ?? (isSeries ? t("series.episode", { number: epLabel }) : playback.series_title)}
      </h1>

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
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

          <div className="relative overflow-hidden rounded-2xl bg-black shadow-[0_0_70px_rgba(122,77,255,0.12)] ring-1 ring-white/10">
            <video
              key={String(playback.direct_play)}
              ref={videoRef}
              src={playback.stream_url}
              controls
              autoPlay
              onLoadedMetadata={resume}
              onTimeUpdate={saveProgress}
              onEnded={markWatched}
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

            {ended && nextEpisode !== null && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center backdrop-blur-sm">
                <span className="text-xs font-semibold tracking-wide text-violet-300 uppercase">
                  {t("player.nextEpisode")}
                </span>
                <span className="text-lg font-bold">
                  {nextEpisode.title ??
                    t("series.episode", { number: episodeLabel(nextEpisode) })}
                </span>
                <span className="text-sm text-neutral-400">
                  {t("player.startingIn", { seconds: countdown })}
                </span>
                <div className="mt-1 flex gap-3">
                  <button
                    onClick={() => navigate(`/watch/${nextEpisode.id}`)}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <Play className="h-4 w-4 fill-current" /> {t("player.playNow")}
                  </button>
                  <button
                    onClick={() => setEnded(false)}
                    className="rounded-xl bg-white/5 px-5 py-2.5 text-sm font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    {t("player.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {playback.subtitle_tracks.length > 0 && (
              <>
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
                    {subtitleLabel(track)}
                  </button>
                ))}
              </>
            )}
            {nextEpisode !== null && (
              <button
                onClick={() => navigate(`/watch/${nextEpisode.id}`)}
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-1.5 text-xs font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                {t("player.next")} <SkipForward className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {isSeries && (
          <EpisodeList episodes={ordered} currentId={id} navigate={navigate} t={t} />
        )}
      </div>
    </div>
  );
}

function EpisodeList({
  episodes,
  currentId,
  navigate,
  t,
}: {
  episodes: Episode[];
  currentId: number;
  navigate: (to: string) => void;
  t: TFunction;
}): JSX.Element {
  return (
    <aside className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10">
      <h2 className="px-4 py-3 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t("player.episodes")}
      </h2>
      <ul className="max-h-[70vh] divide-y divide-white/5 overflow-y-auto">
        {episodes.map((episode) => {
          const current = episode.id === currentId;
          return (
            <li key={episode.id}>
              <button
                onClick={() => navigate(`/watch/${episode.id}`)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                  current ? "bg-[#7A4DFF]/[0.12] text-white" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="w-8 shrink-0 text-right tabular-nums text-neutral-500">
                  {episodeLabel(episode)}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${episode.watched ? "text-neutral-400" : "text-neutral-100"}`}
                >
                  {episode.title ?? t("series.episode", { number: episodeLabel(episode) })}
                </span>
                {current ? (
                  <Play className="h-3.5 w-3.5 shrink-0 fill-current text-violet-300" />
                ) : episode.watched ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-label="watched" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
