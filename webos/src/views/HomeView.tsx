import React, { useEffect, useState } from "react";
import { type HomeData, type HomeSeries, type Library, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useTvInput } from "../hooks";
import { TopNav, type NavTab } from "../components/TopNav";
import { StatusBar } from "../components/StatusBar";
import { theme } from "../theme";
import { aspectHeight } from "../util";

interface Props {
  onSeries: (id: number) => void;
  onPlay: (episodeId: number) => void;
  onLibrary: (id: number) => void;
  onSettings: () => void;
}

const TABS: NavTab[] = [
  { id: "home", label: "Főoldal" },
  { id: "continue", label: "Folytatás" },
  { id: "anime", label: "Anime" },
  { id: "movie", label: "Filmek" },
  { id: "series", label: "Sorozatok" },
  { id: "settings", label: "Beállítások" },
];

const POSTER_W = 150;
const HERO_W = 230;

export default function HomeView({ onSeries, onPlay, onLibrary, onSettings }: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const [data, setData] = useState<HomeData | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState({ z: 0, i: 0 });

  useEffect(() => {
    if (!api) return;
    api.getHome().then(setData).catch((e: unknown) => setError(String(e)));
    api.getLibraries().then(setLibraries).catch(() => undefined);
  }, [api]);

  const img = (url: string | null): string | undefined =>
    mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, url);
  const label = (s: HomeSeries): string => s.display_title ?? s.title;

  const hero: HomeSeries | null = data?.continue_watching[0] ?? null;
  const recent = data?.recently_added ?? [];

  // Ordered focus zones (only those with content).
  const zones: { id: string; len: number }[] = [{ id: "nav", len: TABS.length }];
  if (hero) zones.push({ id: "hero", len: 1 });
  if (recent.length) zones.push({ id: "recent", len: recent.length });
  if (libraries.length) zones.push({ id: "libs", len: libraries.length });

  const zone = zones[Math.min(focus.z, zones.length - 1)] ?? zones[0];

  // Keep the focused card in view.
  useEffect(() => {
    const el = document.querySelector(`[data-f="${focus.z}-${focus.i}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest", inline: "center" });
  }, [focus]);

  const openTab = (id: string): void => {
    if (id === "settings") onSettings();
    else if (id === "anime" || id === "movie" || id === "series") {
      const lib = libraries.find((l) => l.kind === id);
      if (lib) onLibrary(lib.id);
    }
    // home / continue stay on this page.
  };

  const activate = (): void => {
    if (zone.id === "nav") openTab(TABS[focus.i].id);
    else if (zone.id === "hero" && hero) {
      if (hero.continue_episode_id !== null) onPlay(hero.continue_episode_id);
      else onSeries(hero.id);
    } else if (zone.id === "recent") onSeries(recent[focus.i].id);
    else if (zone.id === "libs") onLibrary(libraries[focus.i].id);
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => ({ z: Math.max(0, f.z - 1), i: 0 }));
    } else if (k === "ArrowDown") {
      e.preventDefault();
      setFocus((f) => ({ z: Math.min(zones.length - 1, f.z + 1), i: 0 }));
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      setFocus((f) => ({ ...f, i: Math.max(0, f.i - 1) }));
    } else if (k === "ArrowRight") {
      e.preventDefault();
      setFocus((f) => ({ ...f, i: Math.min(zone.len - 1, f.i + 1) }));
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      activate();
    }
  };

  useTvInput(onKey, () => history.pushState({ mv: true }, "")); // home: Back stays

  const navFocus = zone.id === "nav" ? focus.i : -1;

  const posterCard = (
    z: number,
    i: number,
    title: string,
    cover: string | null,
    sub: string | undefined,
    aspect: "2/3" | "16/9",
    w: number,
    pct?: number,
  ): React.JSX.Element => {
    const focused = focus.z === z && focus.i === i;
    const h = aspectHeight(w, aspect);
    const src = img(cover);
    return (
      <div
        data-f={`${z}-${i}`}
        style={{
          width: w,
          flexShrink: 0,
          marginRight: "0.9rem",
          background: theme.surface,
          border: `3px solid ${focused ? theme.accent : "transparent"}`,
          borderRadius: theme.radius,
          overflow: "hidden",
          boxShadow: focused ? "0 0 18px rgba(122,77,255,0.6)" : "none",
        }}
      >
        <div style={{ position: "relative", width: "100%", height: h, background: "#11131f" }}>
          {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          {pct != null && pct > 0 && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "rgba(0,0,0,0.5)" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: theme.gradient }} />
            </div>
          )}
        </div>
        <div style={{ padding: "0.4rem 0.5rem" }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          {sub && <div style={{ fontSize: "0.7rem", color: theme.muted }}>{sub}</div>}
        </div>
      </div>
    );
  };

  const heroZ = 1;
  const recentZ = hero ? 2 : 1;
  const libsZ = (hero ? 2 : 1) + (recent.length ? 1 : 0);

  return (
    <div className="mv-app" style={{ height: "100vh", overflowY: "auto", paddingBottom: "3.5rem" }}>
      <TopNav tabs={TABS} activeId="home" focusIdx={navFocus} onActivate={openTab} />

      <div style={{ padding: "0.5rem 2.5rem" }}>
        {!data && !error && <p style={{ color: theme.muted }}>Betöltés…</p>}
        {error && <p style={{ color: "#f87171" }}>Betöltési hiba: {error}</p>}

        {/* Continue hero */}
        {hero && (
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>Folytatás</h2>
            <div
              data-f={`${heroZ}-0`}
              style={{
                display: "flex",
                gap: "1.5rem",
                alignItems: "center",
                background: focus.z === heroZ ? "rgba(122,77,255,0.12)" : theme.surface,
                border: `3px solid ${focus.z === heroZ ? theme.accent : "transparent"}`,
                borderRadius: 16,
                padding: "1.2rem",
                boxShadow: focus.z === heroZ ? "0 0 22px rgba(122,77,255,0.5)" : "none",
              }}
            >
              <div style={{ width: HERO_W, flexShrink: 0 }}>
                {img(hero.continue_thumbnail_url ?? hero.cover_image_url) && (
                  <img src={img(hero.continue_thumbnail_url ?? hero.cover_image_url)} alt="" style={{ width: "100%", height: aspectHeight(HERO_W, "16/9"), objectFit: "cover", borderRadius: 10, display: "block" }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff" }}>{label(hero)}</div>
                <div style={{ color: theme.muted, fontSize: "0.9rem", margin: "0.3rem 0 0.6rem" }}>
                  {hero.continue_season_number !== null
                    ? `${hero.continue_season_number}. évad · ${hero.continue_episode_number}. rész`
                    : hero.year}
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    background: theme.gradient,
                    color: "#fff",
                    padding: "0.6rem 1.4rem",
                    borderRadius: 999,
                    fontWeight: 700,
                    boxShadow: focus.z === heroZ ? "0 0 18px rgba(122,77,255,0.8)" : "none",
                  }}
                >
                  ▶ Folytatás
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Recently added */}
        {recent.length > 0 && (
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>Nemrég hozzáadva</h2>
            <div className="mv-row" style={{ display: "flex", overflowX: "auto", padding: "0.4rem 0" }}>
              {recent.map((s, i) =>
                posterCard(recentZ, i, label(s), s.cover_image_url, s.year ? String(s.year) : undefined, "2/3", POSTER_W),
              )}
            </div>
          </section>
        )}

        {/* Libraries */}
        {libraries.length > 0 && (
          <section style={{ marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>Könyvtárak</h2>
            <div className="mv-row" style={{ display: "flex", overflowX: "auto", padding: "0.4rem 0" }}>
              {libraries.map((lib, i) => {
                const focused = focus.z === libsZ && focus.i === i;
                return (
                  <div
                    key={lib.id}
                    data-f={`${libsZ}-${i}`}
                    style={{
                      width: 220,
                      flexShrink: 0,
                      marginRight: "0.9rem",
                      background: focused ? "rgba(122,77,255,0.16)" : theme.surface,
                      border: `3px solid ${focused ? theme.accent : "transparent"}`,
                      borderRadius: theme.radius,
                      padding: "1.3rem 1.1rem",
                      boxShadow: focused ? "0 0 18px rgba(122,77,255,0.6)" : "none",
                    }}
                  >
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff" }}>{lib.name}</div>
                    <div style={{ fontSize: "0.78rem", color: theme.muted, marginTop: 4 }}>{lib.series_count} cím</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
