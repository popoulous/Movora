import { Check, ChevronLeft, Pause, Play, SkipForward } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { type Season } from "../api";
import { episodeLabel, seasonOrder, subtitleLabels, usePlayback } from "../hooks/usePlayback";

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
            // data-active is used by TvPlayerPage to focus this button after panel opens
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

  // Always-current refs — safe to read from capture-phase listeners and effects
  const panelOpenRef = useRef(false);
  panelOpenRef.current = panelOpen;

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activityTimerRef = useRef<number | null>(null);
  const panelTimerRef = useRef<number | null>(null);

  // ── Controls top-bar auto-hide ─────────────────────────────────────────────

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

  // ── Panel auto-hide ────────────────────────────────────────────────────────

  const startPanelTimer = useCallback((): void => {
    if (panelTimerRef.current !== null) window.clearTimeout(panelTimerRef.current);
    panelTimerRef.current = window.setTimeout(() => setPanelOpen(false), 2000);
  }, []);

  useEffect(() => {
    if (!panelOpen) {
      if (panelTimerRef.current !== null) {
        window.clearTimeout(panelTimerRef.current);
        panelTimerRef.current = null;
      }
      return;
    }
    // Start the 2-second auto-hide countdown
    startPanelTimer();
    // Focus the currently-playing episode card after the slide-in animation (300 ms)
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus();
    }, 320);
    return () => {
      window.clearTimeout(focusTimer);
      if (panelTimerRef.current !== null) {
        window.clearTimeout(panelTimerRef.current);
        panelTimerRef.current = null;
      }
    };
  }, [panelOpen, startPanelTimer]);

  // ── Global capture listener: panel keyboard ────────────────────────────────
  // Uses capture phase (fires before spatial nav's bubble listener) so Escape/
  // Back reliably closes the panel without competing with other handlers.
  // panelOpenRef is always current, so no closure-staleness issue.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!panelOpenRef.current) return;
      showControls();
      startPanelTimer(); // any key while panel is open resets the auto-hide timer
      if (e.key === "Escape" || e.key === "Backspace") {
        e.stopImmediatePropagation(); // prevent spatial nav + React handlers from also firing
        e.preventDefault();
        setPanelOpen(false);
        rootRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [showControls, startPanelTimer]); // both are stable useCallback instances

  // ── Play / pause ───────────────────────────────────────────────────────────

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (video === null) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  // ── mediaSession: TV remote media keys ────────────────────────────────────

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
      video.currentTime -= 10;
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

  // ── Root-div keyboard handler ──────────────────────────────────────────────
  // Only handles keys when the panel is CLOSED. Panel-open keys (Escape/Back)
  // are handled by the global capture listener above.

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    showControls();
    // When panel is open the capture listener already handled it (or will).
    // Don't double-process here.
    if (panelOpenRef.current) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (isSeries) setPanelOpen(true);
        break;
      case "Enter":
        // Play/pause only when the root div itself is the focus target
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
        if (document.activeElement === rootRef.current) {
          e.preventDefault();
          navigate(`/series/${playback?.series_id ?? ""}`);
        }
        break;
    }
  };

  // ── Derived subtitle data ──────────────────────────────────────────────────

  const vttTracks = playback?.subtitle_tracks.filter((track) => track.format === "vtt") ?? [];
  const vttSubLabels = subtitleLabels(vttTracks);

  // ── Loading / error states ─────────────────────────────────────────────────

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

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 overflow-hidden select-none bg-black"
      tabIndex={0}
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

      {/* Video — no native controls; custom UI is the control surface */}
      <video
        key={String(playback.direct_play)}
        ref={videoRef}
        src={playback.stream_url}
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={resume}
        onTimeUpdate={handleTimeUpdate}
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

      {/* Top bar — fades after 3 s of inactivity */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-8 pt-8 pb-20 transition-opacity duration-500 ${
          controlsActive ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            onClick={() => navigate(`/series/${playback.series_id}`)}
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

      {/* Skip intro / outro chip */}
      {skip !== null && !ended && !panelOpen && (
        <button
          onClick={doSkip}
          className="absolute right-8 bottom-32 inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25"
        >
          {t(skip === "intro" ? "player.skipIntro" : "player.skipOutro")}
          <SkipForward className="h-4 w-4" />
        </button>
      )}

      {/* Near-end next episode chip */}
      {nearEnd && !ended && nextEpisode !== null && skip === null && !panelOpen && (
        <button
          onClick={() => navigate(`/watch/${nextEpisode.id}`)}
          className="absolute right-8 bottom-32 inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25"
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

      {/* Bottom panel — slides up on ↓ D-pad, auto-hides after 2 s */}
      <div
        ref={panelRef}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/95 to-black/80 transition-transform duration-300 ${
          panelOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Episode carousel */}
        {series !== null && isSeries && (
          <TvEpisodeCarousel
            seasons={series.seasons}
            currentId={id}
            navigate={(to) => navigate(to)}
          />
        )}

        {/* Controls row: subtitle chips + play/pause + next episode */}
        <div className="flex flex-wrap items-center gap-3 px-6 pb-8 pt-2">
          {vttTracks.length > 0 && (
            <>
              <span className="mr-1 text-sm text-neutral-400">{t("player.subtitles")}:</span>
              <button
                onClick={() => setTrackId(null)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
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
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    trackId === track.id
                      ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white"
                      : "bg-white/5 text-neutral-300 ring-1 ring-white/10 hover:bg-white/10"
                  }`}
                >
                  {vttSubLabels[track.id]}
                </button>
              ))}
            </>
          )}

          <div className="flex-1" />

          <button
            onClick={togglePlay}
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20"
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
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20"
            >
              {t("player.next")} <SkipForward className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
