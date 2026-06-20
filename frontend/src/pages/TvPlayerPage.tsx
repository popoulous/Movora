import fontExtUrl from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2?url";
import fontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url";
import { Check, ChevronLeft, Loader2, Pause, Play, SkipForward } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { type Season } from "../api";
import { episodeLabel, seasonOrder, subtitleLabels, usePlayback } from "../hooks/usePlayback";
import { formatTime } from "../playerUtils";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

type NavDirection = "up" | "down" | "left" | "right";

// Spatial nav scoped to a container element — same scoring as useSpatialNav
// but restricted to descendants of `container`.
function findNearestInElement(
  active: Element | null,
  direction: NavDirection,
  container: HTMLElement | null,
): HTMLElement | null {
  if (container === null || active === null) return null;
  const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const cr = active.getBoundingClientRect();
  const cx = (cr.left + cr.right) / 2;
  const cy = (cr.top + cr.bottom) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of els) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const ex = (r.left + r.right) / 2;
    const ey = (r.top + r.bottom) / 2;
    const ok =
      (direction === "up" && ey < cy - 4) ||
      (direction === "down" && ey > cy + 4) ||
      (direction === "left" && ex < cx - 4) ||
      (direction === "right" && ex > cx + 4);
    if (!ok) continue;
    const primary =
      direction === "up" || direction === "down" ? Math.abs(ey - cy) : Math.abs(ex - cx);
    const perp =
      direction === "up" || direction === "down" ? Math.abs(ex - cx) : Math.abs(ey - cy);
    const score = primary + perp * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

const MOVORA_PANEL_KEY = "movoraPanelOpen";

// ── Subtitle style ────────────────────────────────────────────────────────────

type SubSize = "s" | "m" | "l";
type SubBackground = "none" | "box" | "solid";
interface SubStyle {
  size: SubSize;
  background: SubBackground;
}

const SUB_PX: Record<SubSize, number> = { s: 24, m: 32, l: 44 };

function loadSubStyle(): SubStyle {
  try {
    const raw = localStorage.getItem("subtitleStyle");
    if (raw !== null) return JSON.parse(raw) as SubStyle;
  } catch {
    /* fall through */
  }
  return { size: "m", background: "none" };
}

function hasPanelState(): boolean {
  try {
    return (
      window.history.state !== null &&
      typeof window.history.state === "object" &&
      (window.history.state as Record<string, unknown>)[MOVORA_PANEL_KEY] === true
    );
  } catch {
    return false;
  }
}

// ── Episode carousel ──────────────────────────────────────────────────────────

function TvEpisodeCarousel({
  seasons,
  currentId,
  navigate,
}: {
  seasons: Season[];
  currentId: number;
  navigate: (to: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const ordered = [...seasons].sort((a, b) => seasonOrder(a.number) - seasonOrder(b.number));
  const currentSeason =
    ordered.find((s) => s.episodes.some((e) => e.id === currentId)) ?? ordered[0];
  const episodes = currentSeason
    ? [...currentSeason.episodes].sort((a, b) => a.number - b.number)
    : [];

  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto px-6 py-3">
      {episodes.map((episode) => {
        const current = episode.id === currentId;
        return (
          <button
            key={episode.id}
            data-active={current ? "true" : undefined}
            onClick={() => navigate(`/watch/${episode.id}`)}
            className={`relative flex w-40 shrink-0 flex-col gap-1.5 rounded-xl bg-white/5 p-2 text-left ring-1 transition focus-visible:outline-none ${
              current
                ? "ring-2 ring-violet-400"
                : "ring-white/10 hover:ring-violet-400/40 focus-visible:ring-2 focus-visible:ring-violet-400"
            }`}
          >
            <div className="relative aspect-video overflow-hidden rounded-lg bg-white/10">
              {episode.thumbnail_url !== null ? (
                <img src={episode.thumbnail_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                  {episodeLabel(episode)}
                </div>
              )}
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-100">
                {episodeLabel(episode)}
              </span>
              {current && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Play className="h-6 w-6 fill-white text-white" />
                </span>
              )}
              {episode.watched && !current && (
                <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
              )}
            </div>
            <div
              className={`truncate text-xs ${current ? "font-semibold text-white" : "text-neutral-300"}`}
            >
              {episode.title ?? t("series.episode", { number: episodeLabel(episode) })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TvPlayerPage(): JSX.Element {
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
    afterOutro,
    normalizing,
    prepareProgress,
    trackId,
    setTrackId,
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
  } = usePlayback(id);

  const [playing, setPlaying] = useState(true);
  const [controlsActive, setControlsActive] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subStyle, setSubStyleState] = useState<SubStyle>(loadSubStyle);

  const setSubStyle = (next: SubStyle): void => {
    setSubStyleState(next);
    localStorage.setItem("subtitleStyle", JSON.stringify(next));
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activityTimerRef = useRef<number | null>(null);

  // Always-current refs for capture-phase document listeners (registered once)
  const panelOpenRef = useRef(false);
  panelOpenRef.current = panelOpen;
  const iSeriesRef = useRef(false);
  iSeriesRef.current = isSeries;

  // ── Mount: clean up any leftover pushState marker ───────────────────────────

  useEffect(() => {
    if (hasPanelState()) {
      window.history.replaceState(null, "");
    }
  }, []);

  // ── Focus root div when the player UI first renders ──────────────────────────
  // The component shows a loading screen while playback === null, so the root
  // div is not in the DOM yet. autoFocus on a <div> is unreliable on
  // webOS Chrome 87. We focus explicitly the moment playback data arrives.

  useEffect(() => {
    if (playback !== null) {
      rootRef.current?.focus();
    }
  }, [playback]);

  // ── Capture-phase ↓ interceptor ─────────────────────────────────────────────
  // handleKeyDown (React onKeyDown) only fires when focus is inside the root
  // div's subtree. If the webOS browser left focus on a layout element behind
  // the overlay, the React handler never sees the ↓ key. A capture-phase
  // document listener fires for any focus location and opens the panel
  // reliably. Uses refs so it is registered once and always reads fresh state.

  useEffect(() => {
    const onArrowDown = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowDown") return;
      if (panelOpenRef.current || !iSeriesRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setPanelOpen(true);
    };
    document.addEventListener("keydown", onArrowDown, true); // capture phase
    return () => document.removeEventListener("keydown", onArrowDown, true);
  }, []);

  // ── Controls top-bar auto-hide ──────────────────────────────────────────────

  const showControls = useCallback((): void => {
    setControlsActive(true);
    if (activityTimerRef.current !== null) window.clearTimeout(activityTimerRef.current);
    activityTimerRef.current = window.setTimeout(() => setControlsActive(false), 3000);
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (activityTimerRef.current !== null) window.clearTimeout(activityTimerRef.current);
    };
  }, [showControls]);

  // ── Panel: focus + webOS Back button interception ───────────────────────────

  useEffect(() => {
    if (!panelOpen) return;

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus();
    }, 50);

    window.history.pushState({ [MOVORA_PANEL_KEY]: true }, "");
    const onPopState = (): void => {
      setPanelOpen(false);
      rootRef.current?.focus();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("popstate", onPopState);
      if (hasPanelState()) {
        window.history.replaceState(null, "");
      }
    };
  }, [panelOpen]);

  // ── mediaSession ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!("mediaSession" in navigator) || playback === null) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: playback.episode_title ?? playback.series_title ?? "Movora",
      artist: playback.series_title ?? "",
      artwork:
        artwork !== null ? [{ src: artwork, sizes: "600x338", type: "image/jpeg" }] : [],
    });
    const video = videoRef.current;
    if (video === null) return;
    navigator.mediaSession.setActionHandler("play", () => void video.play());
    navigator.mediaSession.setActionHandler("pause", () => video.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      video.currentTime += 10;
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    };
  }, [playback, artwork, videoRef]);

  // ── Subtitle style injection ─────────────────────────────────────────────────
  // Native <track> VTT cues are styled via ::cue CSS. We inject @font-face for
  // Noto Sans including the latin-ext subset (covers Hungarian ő U+0151 /
  // ű U+0171 in Latin Extended-A) so the TV browser doesn't fall back to a
  // system font that lacks those glyphs.

  useEffect(() => {
    const STYLE_ID = "movora-tv-cue";
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (el === null) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    const px = SUB_PX[subStyle.size];
    const bgColor =
      subStyle.background === "solid"
        ? "rgba(0,0,0,0.9)"
        : subStyle.background === "box"
          ? "rgba(0,0,0,0.65)"
          : "transparent";
    const shadow =
      subStyle.background === "none"
        ? "1px 1px 3px rgba(0,0,0,0.95),-1px -1px 3px rgba(0,0,0,0.95)"
        : "none";
    el.textContent = [
      `@font-face{font-family:'NotoSansTV';src:url('${fontExtUrl}')format('woff2');font-weight:400;font-style:normal;unicode-range:U+0100-024F,U+0259,U+1E00-1EFF;}`,
      `@font-face{font-family:'NotoSansTV';src:url('${fontUrl}')format('woff2');font-weight:400;font-style:normal;}`,
      `::cue{font-family:'NotoSansTV',sans-serif;font-size:${px}px;color:white;background-color:${bgColor};text-shadow:${shadow};}`,
    ].join("\n");
    return () => {
      el?.remove();
    };
  }, [subStyle]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (video === null) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const seek = (delta: number): void => {
    const video = videoRef.current;
    if (video === null) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  };

  // ── Keyboard handler ────────────────────────────────────────────────────────

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    showControls();

    if (panelOpen) {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack") {
        e.preventDefault();
        e.stopPropagation();
        setPanelOpen(false);
        rootRef.current?.focus();
        return;
      }

      const dirMap: Partial<Record<string, NavDirection>> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const dir = dirMap[e.key];
      if (dir !== undefined) {
        // Scoped navigation within the panel; spatial nav must not escape to
        // elements outside the panel (e.g. top bar buttons on webOS).
        e.preventDefault();
        e.stopPropagation();
        const next = findNearestInElement(document.activeElement, dir, panelRef.current);
        if (next !== null) {
          next.focus();
        } else if (dir === "up") {
          // Nothing above in the panel → close (Plex-style)
          setPanelOpen(false);
          rootRef.current?.focus();
        }
        // Other directions with no candidate: do nothing (panel boundary)
      }
      return;
    }

    // Panel closed — intercept all arrow keys to prevent spatial nav from
    // stealing focus away from the player root div.
    const isArrow =
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight";
    if (isArrow) {
      e.stopPropagation();
    }

    switch (e.key) {
      case "ArrowUp": {
        // The skip/next-ep chip sits near the bottom of the screen. Spatial nav
        // can't find it going "up" from the root div because the root div's
        // centre (540 px) is above the chip (≈930 px on 1080p). Navigate there
        // explicitly when focus is on the root div and a chip is visible.
        const onRoot =
          document.activeElement === rootRef.current ||
          document.activeElement === null ||
          document.activeElement === document.body;
        if (onRoot) {
          const chip = rootRef.current?.querySelector<HTMLElement>("[data-tv-chip]");
          if (chip !== null && chip !== undefined) {
            e.preventDefault();
            chip.focus();
          }
        }
        break;
      }
      case "ArrowDown": {
        // Focus is on the floating chip → return to root div.
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement.hasAttribute("data-tv-chip")
        ) {
          e.preventDefault();
          rootRef.current?.focus();
          break;
        }
        if (isSeries) {
          e.preventDefault();
          setPanelOpen(true);
        }
        break;
      }
      case "ArrowLeft":
        e.preventDefault();
        seek(-10);
        break;
      case "ArrowRight":
        e.preventDefault();
        seek(10);
        break;
      case "Enter":
        if (
          document.activeElement === rootRef.current ||
          document.activeElement === null ||
          document.activeElement === document.body
        ) {
          e.preventDefault();
          togglePlay();
        }
        break;
      case "Escape":
      case "Backspace":
      case "GoBack":
        e.preventDefault();
        navigate(`/series/${playback?.series_id ?? ""}`);
        break;
    }
  };

  // ── Progress bar click-to-seek ───────────────────────────────────────────────
  // The progress bar sits above the click-to-pause overlay in stacking order
  // (later in DOM, same stacking context). stopPropagation prevents the click
  // from bubbling up to the root div and triggering togglePlay.

  const handleProgressClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const video = videoRef.current;
    if (video !== null && duration > 0) {
      const newTime = ratio * duration;
      video.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────────────

  const vttTracks = playback?.subtitle_tracks.filter((track) => track.format === "vtt") ?? [];
  const vttSubLabels = subtitleLabels(vttTracks);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Loading / error ──────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (playback === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
        <p className="text-sm text-neutral-500">{t("player.loading")}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 select-none bg-black"
      tabIndex={0}
      autoFocus
      onKeyDown={handleKeyDown}
      onPointerMove={showControls}
    >
      {/* Blurred artwork backdrop */}
      {artwork !== null && (
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${artwork})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(40px)",
          }}
        />
      )}

      {/* Video — only once a playable source exists; never play the un-optimized original. */}
      {playback.direct_play ? (
        <video
          key={String(playback.direct_play)}
          ref={videoRef}
          src={playback.stream_url}
          autoPlay
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={() => {
            resume();
            setDuration(videoRef.current?.duration ?? 0);
          }}
          onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
          onTimeUpdate={() => {
            handleTimeUpdate();
            setCurrentTime(videoRef.current?.currentTime ?? 0);
          }}
          onEnded={markWatched}
          className="absolute inset-0 h-full w-full object-contain"
        >
          {vttTracks.map((track) => (
            <track
              key={track.id}
              kind="subtitles"
              src={track.url}
              srcLang={track.language ?? undefined}
              default={track.id === trackId}
            />
          ))}
        </video>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
          {normalizing ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-violet-300" />
              <span className="text-lg text-neutral-200">
                {t("player.optimizing")} · {prepareProgress}%
              </span>
            </>
          ) : (
            <span className="text-lg text-neutral-400">{t("player.notPlayable")}</span>
          )}
        </div>
      )}

      {/* Click-to-play/pause — sits behind all other interactive layers */}
      <div className="absolute inset-0 cursor-pointer" onClick={togglePlay} />

      {/* Top bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-8 pt-8 pb-20 transition-opacity duration-500 ${
          controlsActive ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            onClick={() => {
              if (panelOpen) {
                setPanelOpen(false);
                rootRef.current?.focus();
                return;
              }
              navigate(`/series/${playback.series_id}`);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-neutral-200 transition hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
            {playback.series_title}
          </button>
          {isSeries && (
            <span className="text-sm text-neutral-400">
              {seasonPart} · {t("series.episode", { number: epLabel })}
            </span>
          )}
          {playback.episode_title !== null && (
            <span className="ml-auto truncate text-sm font-semibold text-white">
              {playback.episode_title}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar — pointer-events-auto so clicks seek instead of toggling
          play/pause. stopPropagation in handleProgressClick prevents the click
          from falling through to the togglePlay overlay beneath. */}
      <div
        className={`absolute inset-x-8 bottom-8 cursor-pointer transition-opacity duration-500 ${
          controlsActive && !panelOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleProgressClick}
      >
        <div className="mb-1.5 flex justify-between text-xs tabular-nums text-neutral-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="h-1 rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Skip intro / outro chip */}
      {skip !== null && !ended && !panelOpen && (
        <button
          data-tv-chip=""
          onClick={doSkip}
          className="absolute right-8 bottom-24 inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {t(skip === "intro" ? "player.skipIntro" : "player.skipOutro")}
          <SkipForward className="h-4 w-4" />
        </button>
      )}

      {/* Near-end next episode chip — shown after outro_end, or as a fallback
          in the last 30 s when no outro is defined for this episode */}
      {(afterOutro || (nearEnd && skip === null)) && !ended && nextEpisode !== null && !panelOpen && (
        <button
          data-tv-chip=""
          onClick={() => navigate(`/watch/${nextEpisode.id}`)}
          className="absolute right-8 bottom-24 inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {t("player.next")} <SkipForward className="h-4 w-4" />
        </button>
      )}

      {/* Episode ended — auto-advance overlay */}
      {ended && nextEpisode !== null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75">
          <span className="text-xs font-semibold tracking-wide text-violet-300 uppercase">
            {t("player.nextEpisode")}
          </span>
          <span className="text-2xl font-bold">
            {nextEpisode.title ?? t("series.episode", { number: episodeLabel(nextEpisode) })}
          </span>
          <span className="text-neutral-400">{t("player.startingIn", { seconds: countdown })}</span>
          <div className="mt-2 flex gap-4">
            <button
              onClick={() => navigate(`/watch/${nextEpisode.id}`)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-6 py-3 font-semibold text-white transition hover:brightness-110"
            >
              <Play className="h-5 w-5 fill-current" /> {t("player.playNow")}
            </button>
            <button
              onClick={() => setEnded(false)}
              className="rounded-xl bg-white/5 px-6 py-3 font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              {t("player.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Bottom panel — absent from DOM when closed (no CSS-transform hiding).
          No auto-hide: ↑ or Back/Escape closes it explicitly (Plex-style).
          Arrow navigation is scoped to the panel — spatial nav cannot escape
          to top bar elements while the panel is open. */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/95 to-black/80"
        >
          {series !== null && isSeries && (
            <TvEpisodeCarousel
              seasons={series.seasons}
              currentId={id}
              navigate={(to) => navigate(to)}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 px-6 pb-8 pt-2">
            {vttTracks.length > 0 && (
              <>
                <span className="mr-1 text-sm text-neutral-400">{t("player.subtitles")}:</span>
                <button
                  onClick={() => setTrackId(null)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    trackId === null
                      ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
                      : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
                  }`}
                >
                  {t("player.subtitlesOff")}
                </button>
                {vttTracks.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => setTrackId(track.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                      trackId === track.id
                        ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
                        : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    {vttSubLabels[track.id]}
                  </button>
                ))}

                {/* Subtitle size: S / M / L */}
                <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
                {(["s", "m", "l"] as const).map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setSubStyle({ ...subStyle, size: sz })}
                    className={`w-9 rounded-full py-1.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                      subStyle.size === sz
                        ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
                        : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    {sz === "s" ? "S" : sz === "m" ? "M" : "L"}
                  </button>
                ))}

                {/* Subtitle background: none / dim / solid */}
                <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
                {(["none", "box", "solid"] as const).map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setSubStyle({ ...subStyle, background: bg })}
                    className={`w-9 rounded-full py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                      subStyle.background === bg
                        ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
                        : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    {bg === "none" ? "—" : bg === "box" ? "▒" : "■"}
                  </button>
                ))}
              </>
            )}

            <div className="flex-1" />

            <button
              onClick={togglePlay}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {playing ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </button>

            {nextEpisode !== null && (
              <button
                onClick={() => navigate(`/watch/${nextEpisode.id}`)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                {t("player.next")} <SkipForward className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
