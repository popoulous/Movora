import React, { useEffect, useState } from "react";
import { type SeriesSummary, type SeriesDetail, type Library, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useTvInput } from "../hooks";
import { TopNav, type NavTab } from "../components/TopNav";
import { StatusBar } from "../components/StatusBar";
import { theme } from "../theme";
import { aspectHeight } from "../util";

interface Props {
  libraryId: number;
  onSeries: (id: number) => void;
  onPlay: (episodeId: number) => void;
  onBack: () => void;
}

const TABS: NavTab[] = [
  { id: "home", label: "Főoldal" },
  { id: "continue", label: "Folytatás" },
  { id: "anime", label: "Anime" },
  { id: "movie", label: "Filmek" },
  { id: "series", label: "Sorozatok" },
  { id: "settings", label: "Beállítások" },
];
const FILTERS = [
  { id: "all", label: "Összes" },
  { id: "popular", label: "Népszerű" },
  { id: "watching", label: "Elkezdett" },
  { id: "done", label: "Befejezett" },
];
const COLS = 5;
const CARD_W = 150;

export default function LibraryView({ libraryId, onSeries, onPlay, onBack }: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const [all, setAll] = useState<SeriesSummary[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zone, setZone] = useState<"nav" | "filters" | "grid">("grid");
  const [navI, setNavI] = useState(2);
  const [filterI, setFilterI] = useState(0);
  const [gridI, setGridI] = useState(0);

  useEffect(() => {
    if (!api) return;
    api.listSeries(libraryId).then((s) => { setAll(s); setError(null); }).catch((e: unknown) => setError(String(e)));
    api.getLibraries().then((libs) => setLibrary(libs.find((l) => l.id === libraryId) ?? null)).catch(() => undefined);
  }, [api, libraryId]);

  const img = (url: string | null): string | undefined =>
    mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, url);

  // Apply the active filter / sort.
  const filter = FILTERS[filterI].id;
  const series = all
    .filter((s) =>
      filter === "done" ? s.watch_status === "completed" : filter === "watching" ? s.watch_status === "watching" : true,
    )
    .sort((a, b) => (filter === "popular" ? 0 : 0)); // popular handled below
  if (filter === "popular") series.sort((a, b) => (b.episode_count - a.episode_count));

  const sel = series[Math.min(gridI, series.length - 1)] ?? null;

  // Fetch the focused series' detail (rating + synopsis) for the left panel.
  useEffect(() => {
    if (!api || !sel) return;
    const id = sel.id;
    const t = setTimeout(() => api.getSeries(id).then(setDetail).catch(() => undefined), 220);
    return () => clearTimeout(t);
  }, [api, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = document.querySelector(`[data-g="${gridI}"]`);
    if (el instanceof HTMLElement && zone === "grid") el.scrollIntoView({ block: "nearest" });
  }, [gridI, zone]);

  const openTab = (id: string): void => {
    if (id === "home") onBack();
    else if (id === "settings") onBack(); // settings reached from home for now
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    const n = series.length;
    if (k === "ArrowUp") {
      e.preventDefault();
      if (zone === "grid") {
        if (gridI >= COLS) setGridI((i) => i - COLS);
        else setZone("filters");
      } else if (zone === "filters") setZone("nav");
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
      if (zone === "nav") setNavI((i) => Math.min(TABS.length - 1, i + 1));
      else if (zone === "filters") setFilterI((i) => Math.min(FILTERS.length - 1, i + 1));
      else if (zone === "grid" && gridI % COLS !== COLS - 1 && gridI + 1 < n) setGridI((i) => i + 1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (zone === "nav") openTab(TABS[navI].id);
      else if (zone === "filters") setGridI(0);
      else if (zone === "grid" && sel) onSeries(sel.id);
    }
  };

  useTvInput(onKey, onBack);

  const continueOrOpen = (): void => {
    if (sel?.continue_episode_id != null) onPlay(sel.continue_episode_id);
    else if (sel) onSeries(sel.id);
  };

  return (
    <div className="mv-app" style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <TopNav tabs={TABS} activeId={library?.kind ?? "anime"} focusIdx={zone === "nav" ? navI : -1} onActivate={openTab} />

      <div style={{ padding: "0 2.5rem 0.4rem" }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 800, margin: "0 0 0.7rem" }}>{library?.name ?? "Könyvtár"}</h1>
        <div style={{ display: "flex", alignItems: "center" }}>
          {FILTERS.map((f, i) => {
            const active = i === filterI;
            const focused = zone === "filters" && i === filterI;
            return (
              <span
                key={f.id}
                onClick={() => setFilterI(i)}
                style={{
                  marginRight: "0.7rem",
                  padding: "0.32rem 0.95rem",
                  borderRadius: 999,
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: active || focused ? "#fff" : theme.muted,
                  background: focused ? theme.gradient : active ? "rgba(122,77,255,0.2)" : "rgba(255,255,255,0.06)",
                  boxShadow: focused ? "0 0 14px rgba(122,77,255,0.6)" : "none",
                }}
              >
                {f.label}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", gap: "1.5rem", padding: "0.6rem 2.5rem 0", minHeight: 0 }}>
        {/* Left detail panel */}
        <aside style={{ width: 280, flexShrink: 0 }}>
          {sel && (
            <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 16, padding: "1.2rem", height: "100%", boxSizing: "border-box" }}>
              {img(sel.cover_image_url) && (
                <img src={img(sel.cover_image_url)} alt="" style={{ width: "100%", borderRadius: 10, marginBottom: "0.9rem", display: "block" }} />
              )}
              <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#fff" }}>{sel.display_title ?? sel.title}</div>
              <div style={{ color: theme.muted, fontSize: "0.85rem", margin: "0.3rem 0 0.6rem" }}>
                {[detail?.score ? `★ ${(detail.score / 10).toFixed(1)}` : null, sel.year, `${sel.episode_count} epizód`].filter(Boolean).join(" · ")}
              </div>
              {detail?.description && (
                <p style={{ color: theme.muted, fontSize: "0.8rem", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {detail.description.replace(/<[^>]+>/g, "")}
                </p>
              )}
              <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span onClick={continueOrOpen} style={{ background: theme.gradient, color: "#fff", padding: "0.55rem 1rem", borderRadius: 999, fontWeight: 700, textAlign: "center", cursor: "pointer" }}>
                  {sel.continue_episode_id != null ? "▶ Folytatás" : "▶ Megnyitás"}
                </span>
                <span onClick={() => onSeries(sel.id)} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", padding: "0.55rem 1rem", borderRadius: 999, fontWeight: 600, textAlign: "center", cursor: "pointer" }}>
                  Részletek
                </span>
              </div>
            </div>
          )}
        </aside>

        {/* Poster grid */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "3.5rem" }}>
          {!all.length && !error && <p style={{ color: theme.muted }}>Betöltés…</p>}
          {error && <p style={{ color: "#f87171" }}>Betöltési hiba: {error}</p>}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: "1rem" }}>
            {series.map((s, i) => {
              const focused = zone === "grid" && i === gridI;
              return (
                <div
                  key={s.id}
                  data-g={i}
                  onClick={() => { setZone("grid"); setGridI(i); onSeries(s.id); }}
                  style={{
                    background: theme.surface,
                    border: `3px solid ${focused ? theme.accent : "transparent"}`,
                    borderRadius: theme.radius,
                    overflow: "hidden",
                    boxShadow: focused ? "0 0 18px rgba(122,77,255,0.65)" : "none",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: "100%", height: aspectHeight(CARD_W, "2/3"), background: "#11131f" }}>
                    {img(s.cover_image_url) && <img src={img(s.cover_image_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                  </div>
                  <div style={{ padding: "0.4rem 0.5rem" }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.display_title ?? s.title}</div>
                    <div style={{ fontSize: "0.7rem", color: theme.muted }}>{[s.year, `${s.episode_count} ep`].filter(Boolean).join(" · ")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
