import { type Dispatch, type RefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { useAuth } from "../AuthContext";
import { api, type Episode, type PlaybackInfo, type SeriesDetail, type SubtitleTrack } from "../api";

const SKIP_LANDING_MARGIN_S = 0.75; // skip lands a beat past the marker, never inside it

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

function languageName(track: SubtitleTrack): string | null {
  const lang = track.language?.toLowerCase();
  if (lang === undefined || lang.length === 0) return null;
  return LANG_NAMES[lang] ?? lang.toUpperCase();
}

function formatName(format: string): string {
  return format === "vtt" ? "SRT" : format.toUpperCase();
}

// Distinguishable labels: unique language name when possible; for tracks sharing a language
// the embedded title or the format disambiguates.
export function subtitleLabels(tracks: SubtitleTrack[]): Record<string, string> {
  const base = tracks.map((track) => languageName(track) ?? `(${formatName(track.format)})`);
  const counts = new Map<string, number>();
  base.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  const result: Record<string, string> = {};
  tracks.forEach((track, index) => {
    const label = base[index];
    if ((counts.get(label) ?? 0) === 1) {
      result[track.id] = label;
      return;
    }
    const title = track.label.trim();
    const generic =
      /^(embedded|external)\b/i.test(title) ||
      title.toUpperCase() === (track.language ?? "").toUpperCase();
    result[track.id] =
      title.length > 0 && !generic ? title : `${label} (${formatName(track.format)})`;
  });
  return result;
}

const LANG_ALIASES: Record<string, string[]> = {
  hu: ["hu", "hun"],
  en: ["en", "eng"],
  ja: ["ja", "jpn", "jp"],
  de: ["de", "ger", "deu"],
  fr: ["fr", "fre", "fra"],
};

function pickDefaultTrack(tracks: SubtitleTrack[], uiLang: string): SubtitleTrack | null {
  const code = uiLang.slice(0, 2).toLowerCase();
  const codes = LANG_ALIASES[code] ?? [code];
  const preferred = tracks.find(
    (track) => track.language !== null && codes.includes(track.language.toLowerCase()),
  );
  return preferred ?? tracks[0] ?? null;
}

export function seasonOrder(number: number): number {
  return number === 0 ? Number.MAX_SAFE_INTEGER : number;
}

export function episodeLabel(episode: Episode): string {
  return episode.end_number !== null
    ? `${episode.number}–${episode.end_number}`
    : String(episode.number);
}

export interface UsePlaybackReturn {
  playback: PlaybackInfo | null;
  series: SeriesDetail | null;
  error: string | null;
  ended: boolean;
  setEnded: Dispatch<SetStateAction<boolean>>;
  countdown: number;
  skip: "intro" | "outro" | null;
  nearEnd: boolean;
  afterOutro: boolean;
  /** True when nothing meaningful follows the credits, so the outro chip should
   *  advance to the next episode instead of merely seeking past the credits. */
  outroLeadsToNext: boolean;
  normalizing: boolean;
  prepareProgress: number;
  prepareEta: number | null;
  trackId: string | null;
  setTrackId: Dispatch<SetStateAction<string | null>>;
  subLabels: Record<string, string>;
  artwork: string | null;
  isSeries: boolean;
  seasonPart: string;
  epLabel: string;
  ordered: Episode[];
  nextEpisode: Episode | null;
  videoRef: RefObject<HTMLVideoElement>;
  handleTimeUpdate: () => void;
  doSkip: () => void;
  markWatched: () => void;
  resume: () => void;
  normalize: () => void;
}

export function usePlayback(id: number): UsePlaybackReturn {
  const { t, i18n } = useTranslation();
  const { refreshSoon } = useActivity();
  const { user } = useAuth();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);

  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [skip, setSkip] = useState<"intro" | "outro" | null>(null);
  const [nearEnd, setNearEnd] = useState(false);
  const [afterOutro, setAfterOutro] = useState(false);
  const [outroLeadsToNext, setOutroLeadsToNext] = useState(true);

  useEffect(() => {
    setPlayback(null);
    setSeries(null);
    setError(null);
    setTrackId(null);
    setNormalizing(false);
    setEnded(false);
    setCountdown(10);
    setSkip(null);
    setNearEnd(false);
    setAfterOutro(false);
    lastSaved.current = 0;
    api
      .getPlayback(id)
      .then((info) => {
        setPlayback(info);
        // The backend auto-optimizes on play (when enabled); poll until it's ready.
        if (info.variant_status === "preparing") setNormalizing(true);
        const preferred = user?.preferred_language ?? i18n.language;
        setTrackId(pickDefaultTrack(info.subtitle_tracks, preferred)?.id ?? null);
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!ended || nextEpisode === null) return;
    if (countdown <= 0) {
      navigate(`/watch/${nextEpisode.id}`);
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [ended, countdown, nextEpisode, navigate]);

  useEffect(() => {
    if (!normalizing) return;
    const timer = setInterval(() => {
      api
        .getPlayback(id)
        .then((info) => {
          setPlayback(info); // live progress while optimizing
          if (info.variant_status !== "preparing") setNormalizing(false);
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [normalizing, id]);

  const saveProgress = (): void => {
    const video = videoRef.current;
    if (video === null || video.currentTime - lastSaved.current < 10) return;
    lastSaved.current = video.currentTime;
    void api.recordWatch(id, { position_seconds: video.currentTime }).catch(() => undefined);
  };

  const handleTimeUpdate = (): void => {
    saveProgress();
    const video = videoRef.current;
    if (video === null || playback === null) return;
    const time = video.currentTime;
    const inWindow = (start: number | null, end: number | null): boolean =>
      start !== null && end !== null && time >= start && time < end - 1;
    const next: "intro" | "outro" | null = inWindow(playback.intro_start, playback.intro_end)
      ? "intro"
      : inWindow(playback.outro_start, playback.outro_end)
        ? "outro"
        : null;
    setSkip((previous) => (previous === next ? previous : next));
    const remaining = video.duration - time;
    const isNearEnd = !isNaN(remaining) && remaining > 0 && remaining < 30;
    setNearEnd((previous) => (previous === isNearEnd ? previous : isNearEnd));
    const isAfterOutro = playback.outro_end !== null && time >= playback.outro_end;
    setAfterOutro((previous) => (previous === isAfterOutro ? previous : isAfterOutro));
    // When the credits run to (nearly) the end of the file, "skipping the outro" and
    // "next episode" are the same act — the chip should advance. A larger gap means
    // post-credits content (an epilogue, a preview), so the chip must only seek past
    // the credits and keep playing.
    const leads =
      playback.outro_end === null ||
      isNaN(video.duration) ||
      video.duration - playback.outro_end <= 10;
    setOutroLeadsToNext((previous) => (previous === leads ? previous : leads));
  };

  const doSkip = (): void => {
    const video = videoRef.current;
    const end = skip === "intro" ? playback?.intro_end : playback?.outro_end;
    // Land a beat AFTER the marker: the fingerprint-matched end is soft by up to a
    // second where the theme crossfades into the episode, and landing inside that
    // tail would still show a flash of the intro/outro.
    if (video !== null && end != null) video.currentTime = end + SKIP_LANDING_MARGIN_S;
  };

  const markWatched = (): void => {
    void api.recordWatch(id, { watched: true }).catch(() => undefined);
    setEnded(true);
  };

  const resume = (): void => {
    const video = videoRef.current;
    if (video === null || playback === null || playback.resume_position <= 0) return;
    // Resume only to a mid-episode position — a saved point in the closing seconds
    // (credits, or a stale save) would drop the viewer at the end of the episode.
    if (isNaN(video.duration) || playback.resume_position < video.duration - 30) {
      video.currentTime = playback.resume_position;
    }
  };

  const normalize = (): void => {
    setNormalizing(true);
    api.normalizeEpisode(id).catch(() => undefined);
    refreshSoon();
  };

  const seasonPart =
    playback === null
      ? ""
      : playback.season_number === 0
        ? t("series.season0")
        : t("series.season", { number: playback.season_number });

  const epLabel =
    playback === null
      ? ""
      : playback.episode_end_number !== null
        ? `${playback.episode_number}–${playback.episode_end_number}`
        : String(playback.episode_number);

  const artwork = playback?.banner_image_url ?? playback?.cover_image_url ?? null;

  const subLabels = useMemo(() => subtitleLabels(playback?.subtitle_tracks ?? []), [playback]);

  return {
    playback,
    series,
    error,
    ended,
    setEnded,
    countdown,
    skip,
    nearEnd,
    afterOutro,
    outroLeadsToNext,
    normalizing,
    prepareProgress: playback?.prepare_progress ?? 0,
    prepareEta: playback?.prepare_eta_seconds ?? null,
    trackId,
    setTrackId,
    subLabels,
    artwork,
    isSeries,
    seasonPart,
    epLabel,
    ordered,
    nextEpisode,
    videoRef,
    handleTimeUpdate,
    doSkip,
    markWatched,
    resume,
    normalize,
  };
}
