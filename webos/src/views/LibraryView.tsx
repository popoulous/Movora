import React, { useEffect, useState } from "react";
import { type SeriesSummary, type Library, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useI18n, type Key } from "../i18n";
import { useTvInput } from "../hooks";
import { TopNav, type NavTab } from "../components/TopNav";
import { theme } from "../theme";

interface Props {
  libraryId: number;
  onSeries: (id: number) => void;
  onLibrary: (id: number) => void;
  onHome: () => void;
  onSettings: () => void;
  onBack: () => void;
}

const FILTERS = ["all", "watching", "done"] as const;
const FILTER_KEY: Record<(typeof FILTERS)[number], Key> = {
  all: "library.all",
  watching: "library.watching",
  done: "library.completed",
};
const COLS = 6;

export default function LibraryView({
  libraryId,
  onSeries,
  onLibrary,
  onHome,
  onSettings,
  onBack,
}: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const { t } = useI18n();
  const [all, setAll] = useState<SeriesSummary[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zone, setZone] = useState<"nav" | "filters" | "grid">("grid");
  const [navI, setNavI] = useState(0);
  const [filterI, setFilterI] = useState(0);
  const [gridI, setGridI] = useState(0);

  useEffect(() => {
    if (!api) return;
    api
      .listSeries(libraryId)
      .then((s) => {
        setAll(s);
        setError(null);
        setLoadedFor(libraryId);
      })
      .catch((e: unknown) => setError(String(e)));
    api.getLibraries().then(setLibraries).catch(() => undefined);
  }, [api, libraryId]);

  const img = (url: string | null): string | undefined =>
    mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, url);

  const library = libraries.find((l) => l.id === libraryId) ?? null;

  // Top nav: Home + one tab per library + Settings. The active tab is this library.
  const navTabs: NavTab[] = [
    { id: "home", label: t("nav.home") },
    ...libraries.map((l) => ({ id: `lib:${l.id}`, label: l.name })),
    { id: "settings", label: t("nav.settings") },
  ];
  const activeId = `lib:${libraryId}`;
  const activeNavIdx = Math.max(
    0,
    navTabs.findIndex((tab) => tab.id === activeId),
  );

  // Apply the active filter.
  const filter = FILTERS[filterI];
  const series = all.filter((s) =>
    filter === "done"
      ? s.watch_status === "completed"
      : filter === "watching"
        ? s.watch_status === "watching"
        : true,
  );

  const sel = series[Math.min(gridI, series.length - 1)] ?? null;
  const loading = loadedFor !== libraryId;

  useEffect(() => {
    const el = document.querySelector(`[data-g="${gridI}"]`);
    if (el instanceof HTMLElement && zone === "grid") el.scrollIntoView({ block: "nearest" });
  }, [gridI, zone]);

  const openTab = (id: string): void => {
    if (id === "home") onHome();
    else if (id === "settings") onSettings();
    else if (id.startsWith("lib:")) {
      const tid = Number(id.slice(4));
      if (tid !== libraryId) onLibrary(tid);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    const n = series.length;
    if (k === "ArrowUp") {
      e.preventDefault();
      if (zone === "grid") {
        if (gridI >= COLS) setGridI((i) => i - COLS);
        else setZone("filters");
      } else if (zone === "filters") {
        setZone("nav");
        setNavI(activeNavIdx);
      }
    } else if (k === "ArrowDown") {
      e.preventDefault();
      if (zone === "nav") setZone("filters");
      else if (zone === "filters") setZone("grid");
      else if (zone === "grid" && gridI + COLS < n) setGridI((i) => i + COLS);
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      if (zone === "nav") setNavI((i) => Math.max(0, i - 1));
      else if (zone === "filters") setFilterI((i) => Math.max(0, i - 1));
      else if (zone === "grid" && gridI % COLS !== 0) setGridI((i) => i - 1);
    } else if (k === "ArrowRight") {
      e.preventDefault();
      if (zone === "nav") setNavI((i) => Math.min(navTabs.length - 1, i + 1));
      else if (zone === "filters") setFilterI((i) => Math.min(FILTERS.length - 1, i + 1));
      else if (zone === "grid" && gridI % COLS !== COLS - 1 && gridI + 1 < n) setGridI((i) => i + 1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (zone === "nav") openTab(navTabs[navI].id);
      else if (zone === "filters") setGridI(0);
      else if (zone === "grid" && sel) onSeries(sel.id);
    }
  };

  useTvInput(onKey, onBack);

  return (
    <div className="mv-app" style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TopNav tabs={navTabs} activeId={activeId} focusIdx={zone === "nav" ? navI : -1} onActivate={openTab} />

      <div style={{ padding: "0 2.5rem 0.5rem" }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 800, margin: "0 0 0.8rem" }}>{library?.name ?? t("library.defaultName")}</h1>
        <div style={{ display: "flex", alignItems: "center" }}>
          {FILTERS.map((f, i) => {
            const active = i === filterI;
            const focused = zone === "filters" && i === filterI;
            return (
              <span
                key={f}
                onClick={() => setFilterI(i)}
                style={{
                  marginRight: "0.7rem",
                  padding: "0.32rem 0.95rem",
                  borderRadius: 999,
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: active || focused ? "#fff" : theme.muted,
                  background: focused
                    ? theme.gradient
                    : active
                      ? "rgba(122,77,255,0.2)"
                      : "rgba(255,255,255,0.06)",
                  boxShadow: focused ? "0 0 14px rgba(122,77,255,0.6)" : "none",
                }}
              >
                {t(FILTER_KEY[f])}
              </span>
            );
          })}
        </div>
      </div>

      {/* Poster grid (full width) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.6rem 2.5rem 3.5rem", minHeight: 0 }}>
        {loading && !error && <p style={{ color: theme.muted }}>{t("common.loading")}</p>}
        {error && <p style={{ color: "#f87171" }}>{t("common.loadError", { error })}</p>}
        {!loading && !error && series.length === 0 && (
          <div style={{ padding: "3rem 0", textAlign: "center", color: theme.muted }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, color: theme.text }}>
              {all.length === 0 ? t("library.emptyTitle") : t("library.noMatchTitle")}
            </div>
            <div style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              {all.length === 0 ? t("library.emptyBody") : t("library.noMatchBody")}
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: "1rem" }}>
          {series.map((s, i) => {
            const focused = zone === "grid" && i === gridI;
            return (
              <div
                key={s.id}
                data-g={i}
                onClick={() => {
                  setZone("grid");
                  setGridI(i);
                  onSeries(s.id);
                }}
                style={{
                  background: theme.surface,
                  border: `3px solid ${focused ? theme.accent : "transparent"}`,
                  borderRadius: theme.radius,
                  overflow: "hidden",
                  boxShadow: focused ? "0 0 18px rgba(122,77,255,0.65)" : "none",
                  cursor: "pointer",
                }}
              >
                {/* 2:3 poster via padding-bottom (Chrome 79 has no CSS aspect-ratio), so it
                    scales with the card's real width at any resolution instead of stretching. */}
                <div style={{ position: "relative", width: "100%", paddingBottom: "150%", background: "#11131f" }}>
                  {img(s.cover_image_url) && (
                    <img
                      src={img(s.cover_image_url)}
                      alt=""
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  )}
                </div>
                <div style={{ padding: "0.4rem 0.5rem" }}>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      color: theme.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.display_title ?? s.title}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: theme.muted }}>
                    {[s.year, t("library.epCount", { count: s.episode_count })].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
