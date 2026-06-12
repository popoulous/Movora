import React, { useEffect, useRef, useState } from "react";
import { type PlaybackInfo, type Episode, type SeriesDetail, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import { aspectHeight } from "../util";
import { Icon } from "../components/Icon";

interface Props {
  episodeId: number;
  onBack: () => void;
  onNext: (id: number) => void;
}

type SkipZone = "intro" | "outro" | null;
type Row = "scrub" | "controls" | "episodes";

const SAVE_INTERVAL_S = 10;
const COUNTDOWN_START = 10;
const PANEL_TIMEOUT = 6000;
const PREPARE_POLL_MS = 4000; // re-ask while a device variant is being built
const SUB_PREF_KEY = "movora_sub_pref";
const EP_W = 200;
const EP_H = aspectHeight(EP_W, "16/9");

type SubSize = "s" | "m" | "l" | "xl" | "xxl" | "xxxl";
type SubBg = "none" | "box" | "solid";
type SubPos = "low" | "mid" | "high";
interface SubStyle {
  size: SubSize;
  bg: SubBg;
  pos: SubPos;
}

const SUB_STYLE_KEY = "movora_sub_style";
const SIZES: SubSize[] = ["s", "m", "l", "xl", "xxl", "xxxl"];
const BGS: SubBg[] = ["none", "box", "solid"];
const POSS: SubPos[] = ["low", "mid", "high"];
const SIZE_VH: Record<SubSize, string> = {
  s: "2.6vh",
  m: "3.4vh",
  l: "4.4vh",
  xl: "5.6vh",
  xxl: "6.8vh",
  xxxl: "8.2vh",
};
const BG_COLOR: Record<SubBg, string> = {
  none: "transparent",
  box: "rgba(0,0,0,0.5)",
  solid: "#000000",
};
// Move the whole cue container up from its default bottom position: bottom ->
// roughly screen centre -> near the top.
const POS_BASE: Record<SubPos, string> = { low: "-2vh", mid: "-42vh", high: "-82vh" };
const SIZE_LABEL: Record<SubSize, string> = {
  s: "Kicsi",
  m: "Közepes",
  l: "Nagy",
  xl: "Óriás",
  xxl: "Hatalmas",
  xxxl: "Maximális",
};
const BG_LABEL: Record<SubBg, string> = { none: "Nincs", box: "Áttetsző", solid: "Tömör" };
const POS_LABEL: Record<SubPos, string> = { low: "Lent", mid: "Közép", high: "Fent" };

function loadSubStyle(): SubStyle {
  try {
    const raw = localStorage.getItem(SUB_STYLE_KEY);
    if (raw) return { size: "m", bg: "box", pos: "mid", ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { size: "m", bg: "box", pos: "mid" };
}

function cycle<T>(arr: T[], cur: T, dir: number): T {
  const i = arr.indexOf(cur);
  return arr[(i + dir + arr.length) % arr.length];
}

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
  const [preparing, setPreparing] = useState(false); // a device variant is being built
  const [blocked, setBlocked] = useState(false); // unplayable here & optimization is off
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [skip, setSkip] = useState<SkipZone>(null);
  const [skipFocused, setSkipFocused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [subIdx, setSubIdx] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelH, setPanelH] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setFocus, setSetFocus] = useState(0); // which setting row is focused
  const [subStyle, setSubStyle] = useState<SubStyle>(loadSubStyle);
  const [row, setRow] = useState<Row>("controls");
  const [col, setCol] = useState(2); // default: play/pause
  const [epFocus, setEpFocus] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const popRef = useRef<() => void>(() => undefined);

  const base = config?.serverUrl ?? "";
  const token = config?.deviceToken ?? null;

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    let timer = 0;
    let seriesFetched = false;
    const fetchSeries = (id: number): void => {
      if (seriesFetched) return;
      seriesFetched = true;
      api.getSeries(id).then((s) => {
        if (!cancelled) setSeries(s);
      }).catch(() => undefined);
    };
    const ready = (i: PlaybackInfo): void => {
      setPreparing(false);
      setBlocked(false);
      setInfo(i);
      setError(null);
      setEnded(false);
      setSkip(null);
      setCountdown(COUNTDOWN_START);
      setSubIdx(-1);
      setPanelOpen(false);
      lastSaved.current = 0;
    };
    const load = (): void => {
      api
        .getPlayback(episodeId)
        .then((i) => {
          if (cancelled) return;
          fetchSeries(i.series_id);
          if (i.variant_status === "preparing") {
            // The TV can't Direct Play this yet; a variant is building. Wait and re-ask.
            setPreparing(true);
            setBlocked(false);
            setInfo(i);
            setError(null);
            timer = window.setTimeout(load, PREPARE_POLL_MS);
            return;
          }
          if (i.variant_status === "unavailable") {
            // Can't play directly and optimization is off — don't spin; tell the user.
            setBlocked(true);
            setPreparing(false);
            setInfo(i);
            setError(null);
            return;
          }
          ready(i);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(String(e));
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [api, episodeId]);

  const flat: Episode[] = series ? series.seasons.flatMap((s) => s.episodes) : [];
  const curIdx = flat.findIndex((e) => e.id === episodeId);
  const prevEpisodeId = curIdx > 0 ? flat[curIdx - 1].id : null;
  const nextEpisodeId = curIdx >= 0 && curIdx + 1 < flat.length ? flat[curIdx + 1].id : null;

  const flashToast = (text: string): void => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2000);
  };

  const handleLoadedMetadata = (): void => {
    const v = videoRef.current;
    if (!v || !info) return;
    setDur(v.duration);
    if (info.resume_position > 5) v.currentTime = info.resume_position;
    // Re-apply the remembered subtitle choice on every episode.
    const pref = localStorage.getItem(SUB_PREF_KEY);
    let chosen = -1;
    if (pref && pref !== "off") {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if (tt.language === pref || tt.label === pref) {
          chosen = i;
          break;
        }
      }
    }
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = i === chosen ? "showing" : "disabled";
    setSubIdx(chosen);
  };

  const handleTimeUpdate = (): void => {
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
      setSkipFocused(false); // the skip window passed
    }
    if (t - lastSaved.current >= SAVE_INTERVAL_S) {
      lastSaved.current = t;
      void api.recordWatch(episodeId, { position_seconds: t });
    }
  };

  const handleEnded = (): void => {
    if (api && info) void api.recordWatch(episodeId, { watched: true });
    setEnded(true);
  };

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

  // Warm the episode thumbnails into the browser cache as soon as the series
  // loads, so the bottom panel opens instantly instead of fetching ~a dozen
  // images the first time it is shown.
  useEffect(() => {
    if (!series) return;
    for (const season of series.seasons) {
      for (const ep of season.episodes) {
        const src = mediaUrl(base, token, ep.thumbnail_url);
        if (src) {
          const im = new Image();
          im.src = src;
        }
      }
    }
  }, [series, base, token]);

  // Keep the focused episode card visible.
  useEffect(() => {
    if (!panelOpen || row !== "episodes") return;
    const el = document.querySelector(`[data-ep-idx="${epFocus}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [panelOpen, row, epFocus]);

  // Measure the panel so subtitles can slide just above it.
  useEffect(() => {
    if (panelOpen && panelRef.current) setPanelH(panelRef.current.offsetHeight);
  }, [panelOpen, flat.length]);



  const armPanelTimer = (): void => {
    if (panelTimer.current) clearTimeout(panelTimer.current);
    panelTimer.current = setTimeout(() => setPanelOpen(false), PANEL_TIMEOUT);
  };

  const openPanel = (): void => {
    setRow("controls");
    setCol(2);
    setEpFocus(curIdx >= 0 ? curIdx : 0);
    setPanelOpen(true);
    armPanelTimer();
  };

  const closePanel = (): void => {
    if (panelTimer.current) clearTimeout(panelTimer.current);
    setPanelOpen(false);
    setSettingsOpen(false);
  };

  const persistStyle = (next: SubStyle): SubStyle => {
    localStorage.setItem(SUB_STYLE_KEY, JSON.stringify(next));
    return next;
  };

  const changeSetting = (rowIdx: number, dir: number): void => {
    setSubStyle((s) => {
      const next: SubStyle = { ...s };
      if (rowIdx === 0) next.size = cycle(SIZES, s.size, dir);
      else if (rowIdx === 1) next.bg = cycle(BGS, s.bg, dir);
      else next.pos = cycle(POSS, s.pos, dir);
      return persistStyle(next);
    });
  };

  const applySetting = (rowIdx: number, value: string): void => {
    setSetFocus(rowIdx);
    setSubStyle((s) => {
      const next: SubStyle = { ...s };
      if (rowIdx === 0) next.size = value as SubSize;
      else if (rowIdx === 1) next.bg = value as SubBg;
      else next.pos = value as SubPos;
      return persistStyle(next);
    });
  };

  const togglePlay = (): void => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seekTo = (t: number): void => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  };

  const seekBy = (d: number): void => {
    const v = videoRef.current;
    if (v) v.currentTime += d;
  };

  const cycleSubtitle = (): void => {
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
    // Remember the choice (by language/label) so the next episode applies it too.
    const tt = next === -1 ? null : v.textTracks[next];
    localStorage.setItem(SUB_PREF_KEY, next === -1 ? "off" : tt?.language || tt?.label || String(next));
    flashToast(next === -1 ? "Felirat: ki" : `Felirat: ${tt?.label || `#${next + 1}`}`);
  };

  const doSkip = (): void => {
    const v = videoRef.current;
    if (!v || !info) return;
    if (skip === "intro" && info.intro_end != null) v.currentTime = info.intro_end;
    else if (skip === "outro" && nextEpisodeId !== null) onNext(nextEpisodeId);
  };

  const runControl = (id: string): void => {
    if (id === "sub") cycleSubtitle();
    else if (id === "prev") {
      if (prevEpisodeId !== null) onNext(prevEpisodeId);
    } else if (id === "rew") seekBy(-10);
    else if (id === "play") togglePlay();
    else if (id === "fwd") seekBy(10);
    else if (id === "next") {
      if (nextEpisodeId !== null) onNext(nextEpisodeId);
    } else if (id === "skip") doSkip();
    else if (id === "set") {
      if (panelTimer.current) clearTimeout(panelTimer.current);
      setSetFocus(0);
      setSettingsOpen(true);
    }
  };

  // The transport buttons, in ←/→ focus order. Skip appears only inside its window.
  type Ctrl = { id: string; icon: string; big?: boolean; on?: boolean };
  const controls: Ctrl[] = [
    { id: "sub", icon: "subtitles", on: subIdx >= 0 },
    { id: "prev", icon: "prev" },
    { id: "play", icon: paused ? "play" : "pause", big: true },
    { id: "next", icon: "next" },
    ...(skip !== null ? [{ id: "skip", icon: "skip" }] : []),
    { id: "set", icon: "settings" },
  ];

  const playEpisode = (ep: Episode | undefined): void => {
    if (!ep) return;
    if (ep.id === episodeId) closePanel();
    else onNext(ep.id);
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    const k = e.key;
    // Route every Back through history.back() -> our popstate handler (on webOS the
    // remote Back fires history.back() rather than a keydown). keyCode 461 = Back.
    if (k === "Escape" || k === "Backspace" || k === "GoBack" || e.keyCode === 461) {
      e.preventDefault();
      history.back();
      return;
    }

    if (settingsOpen) {
      // Don't auto-close the panel while the settings sub-view is open.
      if (panelTimer.current) clearTimeout(panelTimer.current);
      if (k === "ArrowUp") {
        e.preventDefault();
        setSetFocus((f) => Math.max(0, f - 1));
      } else if (k === "ArrowDown") {
        e.preventDefault();
        setSetFocus((f) => Math.min(2, f + 1));
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        changeSetting(setFocus, -1);
      } else if (k === "ArrowRight") {
        e.preventDefault();
        changeSetting(setFocus, 1);
      } else if (k === "Enter" || k === " ") {
        e.preventDefault();
        setSettingsOpen(false);
        armPanelTimer();
      }
      return;
    }

    if (!panelOpen) {
      if (k === "Enter" || k === " ") {
        e.preventDefault();
        if (ended && nextEpisodeId !== null) onNext(nextEpisodeId);
        else if (skipFocused) {
          doSkip(); // the user chose to skip
          setSkipFocused(false);
        } else togglePlay();
      } else if (k === "ArrowLeft") {
        if (!skipFocused) seekBy(-10);
      } else if (k === "ArrowRight") {
        if (!skipFocused) seekBy(10);
      } else if (k === "ArrowDown") {
        e.preventDefault();
        // First Down focuses the skip chip (if shown); a second Down opens the panel.
        if (skip !== null && !skipFocused) setSkipFocused(true);
        else {
          setSkipFocused(false);
          openPanel();
        }
      } else if (k === "ArrowUp") {
        e.preventDefault();
        if (skipFocused) setSkipFocused(false);
        else openPanel();
      }
      return;
    }

    // Panel open
    armPanelTimer();
    if (k === "ArrowUp") {
      e.preventDefault();
      if (row === "episodes") setRow("controls");
      else if (row === "controls") setRow("scrub");
      else closePanel(); // up from the scrubber closes
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      if (row === "scrub") setRow("controls");
      else if (row === "controls") setRow("episodes");
      return;
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      if (row === "scrub") seekBy(-10);
      else if (row === "controls") setCol((c) => Math.max(0, c - 1));
      else setEpFocus((i) => Math.max(0, i - 1));
      return;
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      if (row === "scrub") seekBy(10);
      else if (row === "controls") setCol((c) => Math.min(controls.length - 1, c + 1));
      else setEpFocus((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (row === "scrub") togglePlay();
      else if (row === "controls") {
        const c = controls[Math.min(col, controls.length - 1)];
        if (c) runControl(c.id);
      } else playEpisode(flat[epFocus]);
    }
  };

  const handleBarClick = (e: React.MouseEvent): void => {
    const bar = barRef.current;
    if (!bar || dur <= 0) return;
    const rect = bar.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * dur);
  };

  // Refresh the handlers the document-level listeners call (avoids stale closures).
  useEffect(() => {
    handlerRef.current = handleKeyDown;
    popRef.current = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        armPanelTimer();
        history.pushState({ mvPlayer: true }, "");
      } else if (panelOpen) {
        setPanelOpen(false);
        history.pushState({ mvPlayer: true }, "");
      } else {
        if (videoRef.current) {
          void api?.recordWatch(episodeId, { position_seconds: videoRef.current.currentTime });
        }
        onBack();
      }
    };
  });

  // A focused <div> is unreliable on webOS, so capture keys at the document level;
  // and the remote Back fires history.back() (not a keydown), so handle it via
  // popstate, with a pushed entry to consume instead of exiting the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => handlerRef.current(e);
    const onPop = (): void => popRef.current();
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", onPop);
    history.pushState({ mvPlayer: true }, "");
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, background: theme.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#f87171", gap: "1rem" }}>
        <p>Lejátszási hiba: {error}</p>
        <button onClick={onBack} style={pillStyle}>Vissza</button>
      </div>
    );
  }

  const streamUrl = info ? mediaUrl(base, token, info.stream_url) : undefined;
  const tracks = info?.subtitle_tracks ?? [];
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const prepProgress = info?.prepare_progress ?? 0;
  const prepEta = info?.prepare_eta_seconds ?? null;
  const prepareLabel =
    prepProgress > 0
      ? `${prepProgress}%${prepEta ? ` · kb. ${Math.max(1, Math.round(prepEta / 60))} perc` : ""}`
      : "Sorban áll…";
  const subShift = panelOpen ? (panelH > 0 ? `-${panelH + 20}px` : "-46vh") : POS_BASE[subStyle.pos];
  const cueCss = `video::cue { font-size: ${SIZE_VH[subStyle.size]}; background-color: ${BG_COLOR[subStyle.bg]}; color: #fff; text-shadow: -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000, 1px 1px 2px #000, 0 2px 5px rgba(0,0,0,0.9); }`;
  const rootStyle = {
    position: "fixed",
    inset: 0,
    background: "#000",
    outline: "none",
    "--sub-shift": subShift,
  } as React.CSSProperties;

  return (
    <div ref={rootRef} style={rootStyle}>
      <style>{cueCss}</style>
      {!info && !preparing && !blocked && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted }}>Betöltés…</div>
      )}

      {blocked && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.1rem", background: theme.bg, textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff" }}>Ez a rész itt nem játszható le</div>
          <div style={{ fontSize: "1rem", color: theme.muted, maxWidth: 680, lineHeight: 1.5 }}>
            A TV nem tudja közvetlenül lejátszani ezt a formátumot, és az automatikus optimalizálás ki van kapcsolva. Kapcsold be a Beállításokban, vagy válassz másik részt.
          </div>
          <div onClick={onBack} style={pillStyle}>Vissza</div>
        </div>
      )}

      {preparing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.1rem", background: theme.bg, textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff" }}>Optimalizálás folyamatban…</div>
          <div style={{ fontSize: "1rem", color: theme.muted, maxWidth: 680, lineHeight: 1.5 }}>
            A TV nem tudja közvetlenül lejátszani ezt a részt, ezért a háttérben készül egy kompatibilis verzió. Amint kész, automatikusan elindul.
          </div>
          <div style={{ width: 440, marginTop: "0.2rem" }}>
            <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{ width: `${info?.prepare_progress ?? 0}%`, height: "100%", background: theme.gradient, transition: "width 0.5s ease" }} />
            </div>
            <div style={{ marginTop: "0.7rem", fontSize: "1.15rem", fontWeight: 700, color: "#fff" }}>{prepareLabel}</div>
          </div>
          <div onClick={onBack} style={pillStyle}>Vissza</div>
        </div>
      )}

      {info && !preparing && !blocked && (
        <video
          ref={videoRef}
          src={streamUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          autoPlay
          onClick={() => (panelOpen ? closePanel() : togglePlay())}
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

      {toast && (
        <div style={{ position: "absolute", top: "2.5rem", left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", color: "#fff", padding: "0.5rem 1.3rem", borderRadius: 999, fontSize: "1rem" }}>{toast}</div>
      )}

      {/* Skip chip on the video (when the panel is closed) */}
      {skip !== null && !ended && !panelOpen && (
        <div
          onClick={() => {
            doSkip();
            setSkipFocused(false);
          }}
          style={{
            position: "absolute",
            right: "3rem",
            bottom: "3rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: theme.gradient,
            color: "#fff",
            padding: "0.7rem 1.3rem",
            borderRadius: theme.radius,
            fontWeight: 700,
            cursor: "pointer",
            border: `3px solid ${skipFocused ? "#fff" : "transparent"}`,
            boxShadow: skipFocused ? "0 0 22px rgba(122,77,255,0.9)" : "none",
            transform: skipFocused ? "scale(1.05)" : "none",
            transition: "transform 0.12s ease, box-shadow 0.12s ease",
          }}
        >
          <Icon name="skip" size={18} />
          {(skip === "intro" ? "Intro kihagyása" : "Következő rész") + (skipFocused ? " ⏎" : " ▼")}
        </div>
      )}

      {/* Bottom panel (▼) — Plex-style */}
      {info && panelOpen && (
        <div
          ref={panelRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "1.6rem 3rem 1.8rem",
            background: "linear-gradient(to top, rgba(5,6,11,0.97) 30%, rgba(5,6,11,0.6) 80%, transparent)",
          }}
        >
          {/* Title + meta */}
          <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff" }}>{info.series_title}</div>
            <div style={{ fontSize: "0.95rem", color: theme.muted, marginTop: 2 }}>
              {info.season_number}. évad · {info.episode_number}. rész
              {info.episode_title ? ` — ${info.episode_title}` : ""}
            </div>
          </div>

          {/* Scrubber (margins, not flex gap — gap is unreliable on webOS Chrome 87) */}
          <div style={{ display: "flex", alignItems: "center", color: "#fff", marginBottom: "1.5rem", height: 24 }}>
            <span style={{ fontSize: "0.95rem", fontVariantNumeric: "tabular-nums", width: 74, textAlign: "right", marginRight: "1.3rem" }}>{fmt(cur)}</span>
            <div
              ref={barRef}
              onClick={handleBarClick}
              style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.22)", borderRadius: 999, cursor: "pointer", position: "relative", boxShadow: row === "scrub" ? `0 0 0 3px ${theme.accent}` : "none" }}
            >
              <div style={{ width: `${pct}%`, height: "100%", background: theme.gradient, borderRadius: 999 }} />
              <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%,-50%)", width: row === "scrub" ? 20 : 14, height: row === "scrub" ? 20 : 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(122,77,255,0.8)" }} />
            </div>
            <span style={{ fontSize: "0.95rem", fontVariantNumeric: "tabular-nums", width: 74, marginLeft: "1.3rem" }}>{fmt(dur)}</span>
          </div>

          {/* Transport controls — fixed box size + margins so focus never reflows */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "1.5rem", height: 66 }}>
            {controls.map((c, i) => {
              const active = row === "controls" && Math.min(col, controls.length - 1) === i;
              const size = c.big ? 62 : 50;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setRow("controls");
                    setCol(i);
                    runControl(c.id);
                    armPanelTimer();
                  }}
                  style={{
                    width: size,
                    height: size,
                    flexShrink: 0,
                    margin: "0 0.55rem",
                    boxSizing: "border-box",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: active ? "#fff" : c.on ? theme.accent : "#e8e8f0",
                    background: active ? theme.gradient : "rgba(255,255,255,0.1)",
                    border: `2px solid ${active ? "transparent" : "rgba(255,255,255,0.18)"}`,
                    boxShadow: active ? "0 0 20px rgba(122,77,255,0.7)" : "none",
                    transition: "background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease",
                  }}
                >
                  <Icon name={c.icon} size={c.big ? 28 : 22} />
                </div>
              );
            })}
          </div>

          {/* Subtitle settings sub-view (gear) replaces the episode strip */}
          {settingsOpen ? (
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", marginBottom: "0.7rem" }}>Felirat beállítások</div>
              {[
                { label: "Méret", options: SIZES.map((v) => ({ v: v as string, l: SIZE_LABEL[v] })), cur: subStyle.size as string },
                { label: "Háttér", options: BGS.map((v) => ({ v: v as string, l: BG_LABEL[v] })), cur: subStyle.bg as string },
                { label: "Pozíció", options: POSS.map((v) => ({ v: v as string, l: POS_LABEL[v] })), cur: subStyle.pos as string },
              ].map((def, ri) => (
                <div
                  key={def.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "0.55rem",
                    padding: "0.45rem 0.7rem",
                    borderRadius: 10,
                    border: `2px solid ${setFocus === ri ? theme.accent : "transparent"}`,
                    background: setFocus === ri ? "rgba(122,77,255,0.14)" : "transparent",
                  }}
                >
                  <span style={{ width: 100, color: theme.muted, fontSize: "0.92rem" }}>{def.label}</span>
                  <div style={{ display: "flex" }}>
                    {def.options.map((opt) => {
                      const sel = opt.v === def.cur;
                      return (
                        <span
                          key={opt.v}
                          onClick={() => applySetting(ri, opt.v)}
                          style={{
                            marginRight: "0.6rem",
                            padding: "0.32rem 0.95rem",
                            borderRadius: 999,
                            fontSize: "0.9rem",
                            fontWeight: 600,
                            cursor: "pointer",
                            color: sel ? "#fff" : theme.muted,
                            background: sel ? theme.gradient : "rgba(255,255,255,0.08)",
                          }}
                        >
                          {opt.l}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: "0.5rem", color: theme.muted, fontSize: "0.78rem" }}>▲▼ Sor · ◀▶ Érték · Back Bezár</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fff", marginBottom: "0.6rem" }}>Részek</div>
              <div className="mv-row" style={{ display: "flex", overflowX: "auto", paddingBottom: "0.3rem" }}>
                {flat.map((ep, i) => {
              const focused = row === "episodes" && i === epFocus;
              const isCurrent = ep.id === episodeId;
              const thumb = mediaUrl(base, token, ep.thumbnail_url);
              const label = ep.end_number != null ? `${ep.number}–${ep.end_number}.` : `${ep.number}.`;
              return (
                <div
                  key={ep.id}
                  data-ep-idx={i}
                  onClick={() => {
                    setRow("episodes");
                    setEpFocus(i);
                    playEpisode(ep);
                  }}
                  style={{
                    width: EP_W,
                    flexShrink: 0,
                    marginRight: "0.8rem",
                    background: theme.surface,
                    border: `3px solid ${focused ? theme.accent : isCurrent ? "rgba(122,77,255,0.5)" : "transparent"}`,
                    borderRadius: theme.radius,
                    cursor: "pointer",
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
                  <div style={{ padding: "0.45rem 0.6rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                      {label} rész{isCurrent ? " ●" : ""}{ep.watched ? " ✓" : ""}
                    </div>
                    {ep.title && (
                      <div style={{ fontSize: "0.7rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.title}</div>
                    )}
                  </div>
                </div>
              );
            })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Ended overlay */}
      {ended && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(5,6,11,0.82)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", gap: "1rem" }}>
          <p style={{ fontSize: "1.6rem", fontWeight: 800 }}>Epizód vége</p>
          <p style={{ color: theme.muted }}>
            {nextEpisodeId !== null ? `Következő rész ${countdown} mp múlva… (Enter)` : `Vissza ${countdown} mp múlva…`}
          </p>
          <button onClick={() => (nextEpisodeId !== null ? onNext(nextEpisodeId) : onBack())} style={{ ...pillStyle, background: theme.gradient, border: "none" }}>
            {nextEpisodeId !== null ? "Következő rész" : "Vissza"}
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
