import fallbackFontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url";
// The latin subset lacks Latin Extended-A (ő, ű …); load the latin-ext face too so
// libass can fall back to it for Hungarian glyphs instead of drawing tofu boxes.
import fallbackFontExtUrl from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2?url";
import { type TFunction } from "i18next";
import JASSUB from "jassub";
import { Check, ChevronLeft, Play, SkipForward, Type } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { useAuth } from "../AuthContext";
import {
  api,
  type Episode,
  type PlaybackInfo,
  type Season,
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

function languageName(track: SubtitleTrack): string | null {
  const lang = track.language?.toLowerCase();
  if (lang === undefined || lang.length === 0) return null;
  return LANG_NAMES[lang] ?? lang.toUpperCase();
}

function formatName(format: string): string {
  return format === "vtt" ? "SRT" : format.toUpperCase();
}

// Distinguishable labels: the language name when it's unique; for tracks sharing a language
// the embedded title (e.g. "Eng Full [SDH]") or the format; language-less tracks show the
// format. So "Magyar / English / English" becomes "Magyar / Eng Full / Eng Full [SDH]".
function subtitleLabels(tracks: SubtitleTrack[]): Record<string, string> {
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

type SubSize = "s" | "m" | "l";
type SubBackground = "none" | "box" | "solid";
interface SubStyle {
  size: SubSize;
  background: SubBackground;
}

const SIZE_SCALE: Record<SubSize, number> = { s: 0.8, m: 1, l: 1.3 };

function loadSubStyle(): SubStyle {
  try {
    const raw = localStorage.getItem("subtitleStyle");
    if (raw !== null) return JSON.parse(raw) as SubStyle;
  } catch {
    /* fall through to the default */
  }
  return { size: "m", background: "none" };
}

// Rewrite an ASS file's [V4+ Styles] for the chosen size and background box. Unchanged for the
// default (medium, no background), so existing files render exactly as authored.
function applyAssStyle(content: string, style: SubStyle): string {
  const scale = SIZE_SCALE[style.size];
  if (scale === 1 && style.background === "none") return content;
  const boxColour = style.background === "solid" ? "&H00000000" : "&H80000000";
  let columns: string[] | null = null;
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (columns === null && /^\s*Format\s*:/i.test(line) && /fontsize/i.test(line)) {
        columns = line
          .replace(/^\s*Format\s*:/i, "")
          .split(",")
          .map((name) => name.trim().toLowerCase());
        return line;
      }
      if (columns === null || !/^\s*Style\s*:/i.test(line)) return line;
      const fields = line.replace(/^\s*Style\s*:/i, "").split(",");
      const at = (name: string): number => columns?.indexOf(name) ?? -1;
      const fs = at("fontsize");
      if (scale !== 1 && fs >= 0 && !Number.isNaN(parseFloat(fields[fs]))) {
        fields[fs] = String(Math.round(parseFloat(fields[fs]) * scale));
      }
      const bs = at("borderstyle");
      if (bs >= 0) fields[bs] = style.background === "none" ? "1" : "3";
      if (style.background !== "none") {
        for (const name of ["outlinecolour", "backcolour"]) {
          const i = at(name);
          if (i >= 0) fields[i] = boxColour;
        }
      }
      return "Style:" + fields.join(",");
    })
    .join("\n");
}

// Native <track> (VTT) styling, applied via a ::cue stylesheet.
function cueCss(style: SubStyle): string {
  const size = { s: "80%", m: "100%", l: "130%" }[style.size];
  const bg = { none: "transparent", box: "rgba(0,0,0,0.55)", solid: "rgba(0,0,0,0.9)" }[
    style.background
  ];
  return `::cue { font-size: ${size}; background-color: ${bg}; }`;
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
  const { user } = useAuth();
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
  const [skip, setSkip] = useState<"intro" | "outro" | null>(null);
  const [subStyle, setSubStyleState] = useState<SubStyle>(loadSubStyle);
  const setSubStyle = (next: SubStyle): void => {
    setSubStyleState(next);
    localStorage.setItem("subtitleStyle", JSON.stringify(next));
  };

  useEffect(() => {
    setPlayback(null);
    setSeries(null);
    setError(null);
    setTrackId(null);
    setNormalizing(false);
    setEnded(false);
    setCountdown(10);
    setSkip(null);
    lastSaved.current = 0;
    api
      .getPlayback(id)
      .then((info) => {
        setPlayback(info);
        // Show a subtitle by default, preferring the account's language, else the UI locale.
        const preferred = user?.preferred_language ?? i18n.language;
        setTrackId(pickDefaultTrack(info.subtitle_tracks, preferred)?.id ?? null);
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
  // Show the Skip button while we're inside a detected intro/outro window (kept up to date
  // on timeupdate); only flips state on a window change to avoid re-rendering every tick.
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
  };
  const doSkip = (): void => {
    const video = videoRef.current;
    const end = skip === "intro" ? playback?.intro_end : playback?.outro_end;
    if (video !== null && end != null) video.currentTime = end;
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
          subContent: applyAssStyle(subContent, subStyle), // user size/background overrides
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
  }, [playback, trackId, subStyle]);

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
  const subLabels = subtitleLabels(playback.subtitle_tracks);

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

      <div className="mt-4 space-y-5">
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
              onTimeUpdate={handleTimeUpdate}
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

            {skip !== null && !ended && (
              <button
                onClick={doSkip}
                className="absolute right-5 bottom-20 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25"
              >
                {t(skip === "intro" ? "player.skipIntro" : "player.skipOutro")}
                <SkipForward className="h-4 w-4" />
              </button>
            )}

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
                    {subLabels[track.id]}
                  </button>
                ))}
                <SubtitleStyleControl style={subStyle} onChange={setSubStyle} t={t} />
                {vttTrack !== null && <style>{cueCss(subStyle)}</style>}
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

        {isSeries && series !== null && (
          <EpisodeBrowser seasons={series.seasons} currentId={id} navigate={navigate} t={t} />
        )}
      </div>
    </div>
  );
}

function SubtitleStyleControl({
  style,
  onChange,
  t,
}: {
  style: SubStyle;
  onChange: (style: SubStyle) => void;
  t: TFunction;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const pill = (active: boolean): string =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white" : "bg-white/5 text-neutral-300 hover:bg-white/10"
    }`;
  const sizes: SubSize[] = ["s", "m", "l"];
  const backgrounds: SubBackground[] = ["none", "box", "solid"];
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title={t("player.subtitleStyle")}
        className={chipClass(open)}
      >
        <Type className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 space-y-3 rounded-xl bg-[#0C0E19]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div>
            <div className="mb-1.5 text-xs text-neutral-400">{t("player.subtitleSize")}</div>
            <div className="flex gap-1.5">
              {sizes.map((size) => (
                <button
                  key={size}
                  onClick={() => onChange({ ...style, size })}
                  className={pill(style.size === size)}
                >
                  {t(`player.size_${size}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs text-neutral-400">{t("player.subtitleBackground")}</div>
            <div className="flex gap-1.5">
              {backgrounds.map((background) => (
                <button
                  key={background}
                  onClick={() => onChange({ ...style, background })}
                  className={pill(style.background === background)}
                >
                  {t(`player.bg_${background}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EpisodeBrowser({
  seasons,
  currentId,
  navigate,
  t,
}: {
  seasons: Season[];
  currentId: number;
  navigate: (to: string) => void;
  t: TFunction;
}): JSX.Element {
  const ordered = [...seasons].sort((a, b) => seasonOrder(a.number) - seasonOrder(b.number));
  const currentSeason =
    ordered.find((season) => season.episodes.some((episode) => episode.id === currentId))?.number ??
    ordered[0]?.number ??
    1;
  const [selected, setSelected] = useState(currentSeason);
  useEffect(() => setSelected(currentSeason), [currentSeason]); // follow the playing episode

  const season = ordered.find((entry) => entry.number === selected) ?? ordered[0];
  const episodes = season ? [...season.episodes].sort((a, b) => a.number - b.number) : [];

  // Click-and-drag horizontal scrolling for mouse users (touch uses native scroll).
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  const onPointerDown = (event: ReactPointerEvent): void => {
    if (event.pointerType !== "mouse" || scrollRef.current === null) return;
    drag.current = {
      active: true,
      startX: event.clientX,
      startScroll: scrollRef.current.scrollLeft,
      moved: false,
    };
  };
  const onPointerMove = (event: ReactPointerEvent): void => {
    if (!drag.current.active || scrollRef.current === null) return;
    const dx = event.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    scrollRef.current.scrollLeft = drag.current.startScroll - dx;
  };
  const endDrag = (): void => {
    drag.current.active = false;
  };
  // Swallow the click that ends a drag so it doesn't navigate to an episode.
  const onClickCapture = (event: ReactMouseEvent): void => {
    if (drag.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-300 uppercase">
          {t("player.episodes")}
        </h2>
        {ordered.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {ordered.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelected(entry.number)}
                className={chipClass(entry.number === selected)}
              >
                {entry.number === 0
                  ? t("series.season0")
                  : t("series.season", { number: entry.number })}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
        className="no-scrollbar -mx-1 flex cursor-grab gap-3 overflow-x-auto px-1 py-1 select-none active:cursor-grabbing"
      >
        {episodes.map((episode) => {
          const current = episode.id === currentId;
          return (
            <button
              key={episode.id}
              onClick={() => navigate(`/watch/${episode.id}`)}
              className="group w-44 shrink-0 text-left sm:w-48"
            >
              <div
                className={`relative aspect-video overflow-hidden rounded-xl bg-white/5 ring-1 transition ${
                  current ? "ring-2 ring-violet-400/70" : "ring-white/10 group-hover:ring-violet-400/40"
                }`}
              >
                {episode.thumbnail_url !== null ? (
                  <img src={episode.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30 text-sm text-neutral-400">
                    {episodeLabel(episode)}
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-100">
                  {episodeLabel(episode)}
                </span>
                <span
                  className={`absolute inset-0 flex items-center justify-center bg-black/30 transition ${
                    current ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <Play className="h-7 w-7 fill-white text-white drop-shadow" />
                </span>
                {episode.watched && !current && (
                  <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-black/30">
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                )}
              </div>
              <div
                className={`mt-1.5 truncate text-sm ${current ? "font-semibold text-white" : "text-neutral-300"}`}
              >
                {episode.title ?? t("series.episode", { number: episodeLabel(episode) })}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
