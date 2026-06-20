import fallbackFontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url";
// The latin subset lacks Latin Extended-A (ő, ű …); load the latin-ext face too so
// libass can fall back to it for Hungarian glyphs instead of drawing tofu boxes.
import fallbackFontExtUrl from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2?url";
import { type TFunction } from "i18next";
import JASSUB from "jassub";
import { Check, ChevronLeft, Loader2, Play, SkipForward, Type } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { type Season } from "../api";
import { episodeLabel, seasonOrder, usePlayback } from "../hooks/usePlayback";

type SubSize = "s" | "m" | "l";
type SubBackground = "none" | "box" | "solid";
interface SubStyle {
  size: SubSize;
  background: SubBackground;
}

const SIZE_SCALE: Record<SubSize, number> = { s: 0.8, m: 1, l: 1.3 };

const AUDIO_PREF_PREFIX = "movora_audio_pref_"; // + seriesId -> remembered audio language

// HTMLMediaElement.audioTracks is non-standard and absent from the TS DOM lib (and from
// Chromium). We feature-detect it: where a browser exposes it the selector works; elsewhere
// it simply doesn't appear.
interface AudioTrackLike {
  language: string;
  label: string;
  enabled: boolean;
}
interface AudioTrackListLike {
  readonly length: number;
  [index: number]: AudioTrackLike;
}
interface AudioMeta {
  language: string;
  label: string;
}
function videoAudioTracks(video: HTMLVideoElement): AudioTrackListLike | null {
  const at = (video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
  return at !== undefined && typeof at.length === "number" ? at : null;
}

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

// WebVTT/SubRip are rendered through JASSUB too (not a native <track>): converting them to a
// minimal ASS gives libass a fixed bottom anchor — reliable, no jumping — and lets the size/
// background controls apply uniformly.
function parseVttTime(value: string): number {
  const match = value.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
  if (match === null) return 0;
  const hours = match[1] !== undefined ? Number(match[1]) : 0;
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function assTime(seconds: number): string {
  const cs = Math.round(seconds * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function assText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/<i>/gi, "{\\i1}")
    .replace(/<\/i>/gi, "{\\i0}")
    .replace(/<b>/gi, "{\\b1}")
    .replace(/<\/b>/gi, "{\\b0}")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .join("\\N");
}

function vttToAss(vtt: string): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2.6,1,2,40,40,46,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  for (const block of vtt.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const rows = block.split("\n").filter((row) => row.length > 0);
    const arrow = rows.findIndex((row) => row.includes("-->"));
    if (arrow < 0) continue;
    const times = rows[arrow].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    const text = rows.slice(arrow + 1).join("\n");
    if (times === null || text.length === 0) continue;
    lines.push(
      `Dialogue: 0,${assTime(parseVttTime(times[1]))},${assTime(parseVttTime(times[2]))},Default,,0,0,0,,${assText(text)}`,
    );
  }
  return header + lines.join("\n") + "\n";
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition ${
    active
      ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
      : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
  }`;
}

export function PlayerPage(): JSX.Element {
  const { t } = useTranslation();
  const { episodeId } = useParams();
  const id = Number(episodeId);
  const navigate = useNavigate();

  const {
    playback,
    series,
    error,
    ended,
    setEnded,
    countdown,
    skip,
    nearEnd,
    normalizing,
    prepareProgress,
    prepareEta,
    trackId,
    setTrackId,
    subLabels,
    artwork,
    isSeries,
    seasonPart,
    epLabel,
    nextEpisode,
    videoRef,
    handleTimeUpdate,
    doSkip,
    markWatched,
    resume,
    normalize,
  } = usePlayback(id);

  const [subStyle, setSubStyleState] = useState<SubStyle>(loadSubStyle);
  const setSubStyle = (next: SubStyle): void => {
    setSubStyleState(next);
    localStorage.setItem("subtitleStyle", JSON.stringify(next));
  };

  const [audioTracks, setAudioTracks] = useState<AudioMeta[]>([]);
  const [audioId, setAudioId] = useState(-1);

  // Read the audio tracks (where the browser exposes them) and apply the series'
  // remembered language. Runs on loadedmetadata, alongside resume().
  const detectAudio = (): void => {
    const video = videoRef.current;
    if (video === null || playback === null) return;
    const at = videoAudioTracks(video);
    if (at === null || at.length === 0) {
      setAudioTracks([]);
      setAudioId(-1);
      return;
    }
    const list: AudioMeta[] = [];
    for (let i = 0; i < at.length; i += 1) {
      list.push({ language: at[i].language || "", label: at[i].label || "" });
    }
    const pref = localStorage.getItem(AUDIO_PREF_PREFIX + playback.series_id);
    let picked = -1;
    if (pref !== null) {
      for (let i = 0; i < at.length; i += 1) {
        if ((at[i].language || "") === pref) {
          picked = i;
          break;
        }
      }
    }
    if (picked === -1) {
      for (let i = 0; i < at.length; i += 1) {
        if (at[i].enabled) {
          picked = i;
          break;
        }
      }
      if (picked === -1) picked = 0;
    }
    for (let i = 0; i < at.length; i += 1) at[i].enabled = i === picked;
    setAudioTracks(list);
    setAudioId(picked);
  };

  const selectAudio = (index: number): void => {
    const video = videoRef.current;
    if (video === null || playback === null) return;
    const at = videoAudioTracks(video);
    if (at === null || index >= at.length) return;
    for (let i = 0; i < at.length; i += 1) at[i].enabled = i === index;
    setAudioId(index);
    // Remember the language for this series so the next episode keeps the same track.
    localStorage.setItem(AUDIO_PREF_PREFIX + playback.series_id, at[index].language || "");
  };

  // Every subtitle (ASS and SRT/VTT alike) is rendered by JASSUB as a canvas overlay; the
  // instance is recreated on track change and destroyed on cleanup.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playback === null) return;
    const selected = playback.subtitle_tracks.find((track) => track.id === trackId);
    if (selected === undefined) return;
    let instance: JASSUB | null = null;
    let cancelled = false;
    void fetch(selected.url)
      .then((response) => response.text())
      .then((raw) => {
        const current = videoRef.current;
        if (cancelled || current === null) return;
        const ass = selected.format === "ass" ? raw : vttToAss(raw);
        instance = new JASSUB({
          video: current,
          subContent: applyAssStyle(ass, subStyle),
          fonts: [...playback.fonts, fallbackFontExtUrl],
          availableFonts: { "noto sans": fallbackFontUrl },
          defaultFont: "noto sans",
          queryFonts: false,
        });
      });
    return () => {
      cancelled = true;
      void instance?.destroy();
    };
  }, [playback, trackId, subStyle, videoRef]);

  if (error !== null) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (playback === null) {
    return <p className="text-sm text-neutral-500">{t("player.loading")}</p>;
  }

  return (
    <div className="relative">
      {artwork !== null && (
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center opacity-[0.12] blur-2xl"
          style={{ backgroundImage: `url(${artwork})` }}
        />
      )}

      {/* Breadcrumb: back to the series, then season · episode */}
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
        {playback.episode_title ??
          (isSeries ? t("series.episode", { number: epLabel }) : playback.series_title)}
      </h1>

      <div className="mt-4 max-w-[1600px] space-y-5">
        <div className="space-y-4">
          {normalizing ? (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">{t("player.optimizing")}</span>
                <span className="shrink-0 font-semibold">
                  {prepareProgress}%
                  {prepareEta ? ` · ~${Math.max(1, Math.round(prepareEta / 60))} ${t("player.min")}` : ""}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] transition-all"
                  style={{ width: `${prepareProgress}%` }}
                />
              </div>
            </div>
          ) : (
            !playback.direct_play && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <span className="min-w-0 flex-1">{t("player.notPlayable")}</span>
                <button
                  onClick={normalize}
                  className="shrink-0 rounded-lg bg-amber-400/20 px-3 py-1.5 font-medium text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/30"
                >
                  {t("player.normalizeNow")}
                </button>
              </div>
            )
          )}

          <div className="tv-player relative overflow-hidden rounded-2xl bg-black shadow-[0_0_70px_rgba(122,77,255,0.12)] ring-1 ring-white/10">
            {!playback.direct_play ? (
              // Don't play the un-optimized original — wait for the variant to be ready.
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
                {normalizing ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-violet-300" />
                    <span className="text-sm text-neutral-300">
                      {t("player.optimizing")} · {prepareProgress}%
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-neutral-400">{t("player.notPlayable")}</span>
                )}
              </div>
            ) : (
              <video
                key={String(playback.direct_play)}
                ref={videoRef}
                src={playback.stream_url}
                controls
                autoPlay
                onLoadedMetadata={() => {
                  resume();
                  detectAudio();
                }}
                onTimeUpdate={handleTimeUpdate}
                onEnded={markWatched}
                className="aspect-video w-full"
              />
            )}

            {skip !== null && !ended && (
              <button
                onClick={doSkip}
                className="absolute right-5 bottom-20 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25"
              >
                {t(skip === "intro" ? "player.skipIntro" : "player.skipOutro")}
                <SkipForward className="h-4 w-4" />
              </button>
            )}

            {nearEnd && !ended && nextEpisode !== null && skip === null && (
              <button
                onClick={() => navigate(`/watch/${nextEpisode.id}`)}
                className="absolute right-5 bottom-20 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25"
              >
                {t("player.next")} <SkipForward className="h-4 w-4" />
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
              </>
            )}
            {audioTracks.length > 1 && (
              <>
                <span className="text-sm text-neutral-400">{t("player.audio")}:</span>
                {audioTracks.map((track, i) => (
                  <button
                    key={`${track.language}-${i}`}
                    onClick={() => selectAudio(i)}
                    className={chipClass(audioId === i)}
                  >
                    {track.label || track.language || `#${i + 1}`}
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
      active
        ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
        : "bg-white/5 text-neutral-300 hover:bg-white/10"
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
  useEffect(() => setSelected(currentSeason), [currentSeason]);

  const season = ordered.find((entry) => entry.number === selected) ?? ordered[0];
  const episodes = season ? [...season.episodes].sort((a, b) => a.number - b.number) : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const card = activeRef.current;
    if (card === null) {
      container.scrollLeft = 0;
      return;
    }
    const cRect = container.getBoundingClientRect();
    const kRect = card.getBoundingClientRect();
    container.scrollLeft += kRect.left - cRect.left - (container.clientWidth - card.clientWidth) / 2;
  }, [currentId, selected]);

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
              ref={current ? activeRef : null}
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
