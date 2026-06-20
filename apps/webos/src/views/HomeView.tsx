import React, { useEffect, useState } from "react";
import { type HomeData, type HomeSeries, type Library, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useI18n } from "../i18n";
import { scrollIntoFocus, useTvInput } from "../hooks";
import { TopNav, type NavTab } from "../components/TopNav";
import { Loader } from "../components/Loader";
import { Icon } from "../components/Icon";
import { theme } from "../theme";
import { aspectHeight } from "../util";

interface Props {
  onSeries: (id: number) => void;
  onPlay: (episodeId: number) => void;
  onLibrary: (id: number) => void;
  onSettings: () => void;
}

const POSTER_W = 200; // 2:3 poster rows, consistent with the library grid + recommendations
const CONT_W = 300;

export default function HomeView({ onSeries, onPlay, onLibrary, onSettings }: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const { t } = useI18n();
  const [data, setData] = useState<HomeData | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState({ z: 0, i: 0 });

  useEffect(() => {
    if (!api) return;
    api.getHome().then(setData).catch((e: unknown) => setError(String(e)));
    api
      .getLibraries()
      .then((l) => {
        setLibraries(l);
        setLibsLoaded(true);
      })
      .catch(() => undefined);
  }, [api]);

  const img = (url: string | null): string | undefined =>
    mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, url);
  const label = (s: HomeSeries): string => s.display_title ?? s.title;

  const cont = data?.continue_watching ?? [];
  const recent = data?.recently_added ?? [];

  // Top nav: Home + one tab per actual library + Settings.
  const navTabs: NavTab[] = [
    { id: "home", label: t("nav.home") },
    ...libraries.map((l) => ({ id: `lib:${l.id}`, label: l.name })),
    { id: "settings", label: t("nav.settings") },
  ];

  // Ordered focus zones (only those with content).
  const zones: { id: string; len: number }[] = [{ id: "nav", len: navTabs.length }];
  if (cont.length) zones.push({ id: "continue", len: cont.length });
  if (recent.length) zones.push({ id: "recent", len: recent.length });
  if (libraries.length) zones.push({ id: "libs", len: libraries.length });

  const zone = zones[Math.min(focus.z, zones.length - 1)] ?? zones[0];

  // Keep the focused card in view.
  useEffect(() => {
    const el = document.querySelector(`[data-f="${focus.z}-${focus.i}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ block: "nearest", inline: "center" }); // horizontal centering
    scrollIntoFocus(el); // reliable vertical visibility (incl. the top nav)
  }, [focus]);

  const openTab = (id: string): void => {
    if (id === "settings") onSettings();
    else if (id.startsWith("lib:")) onLibrary(Number(id.slice(4)));
    // home stays on this page.
  };

  const activate = (): void => {
    if (zone.id === "nav") openTab(navTabs[focus.i].id);
    else if (zone.id === "continue") {
      const it = cont[focus.i];
      if (it.continue_episode_id !== null) onPlay(it.continue_episode_id);
      else onSeries(it.id);
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
    completed = false,
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
          {completed && (
            <span style={{ position: "absolute", top: 8, left: 8, background: theme.gradient, color: "#fff", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, padding: "2px 8px" }}>✓</span>
          )}
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

  const contZ = 1;
  const recentZ = 1 + (cont.length ? 1 : 0);
  const libsZ = recentZ + (recent.length ? 1 : 0);

  return (
    <div className="mv-app" style={{ height: "100vh", overflowY: "auto", paddingBottom: "2rem" }}>
      <TopNav tabs={navTabs} activeId="home" focusIdx={navFocus} onActivate={openTab} zoneIndex={0} />

      <div style={{ padding: "0.5rem 2.5rem" }}>
        {!data && !error && (
          <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader />
          </div>
        )}
        {error && <p style={{ color: "#f87171" }}>{t("common.loadError", { error })}</p>}

        {/* Continue watching — a row of resumable cards. */}
        {cont.length > 0 && (
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>{t("home.continue")}</h2>
            <div className="mv-row" style={{ display: "flex", overflowX: "auto", padding: "0.4rem 0" }}>
              {cont.map((s, i) => {
                const sub =
                  s.continue_season_number !== null
                    ? t("ep.seasonEpisode", { season: s.continue_season_number, episode: s.continue_episode_number ?? 0 })
                    : s.continue_episode_number !== null
                      ? t("ep.episodeOnly", { episode: s.continue_episode_number })
                      : s.year
                        ? String(s.year)
                        : undefined;
                return posterCard(
                  contZ,
                  i,
                  label(s),
                  s.continue_thumbnail_url ?? s.cover_image_url,
                  sub,
                  "16/9",
                  CONT_W,
                  s.continue_percent,
                );
              })}
            </div>
          </section>
        )}

        {/* Recently added */}
        {recent.length > 0 && (
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>{t("home.recentlyAdded")}</h2>
            <div className="mv-row" style={{ display: "flex", overflowX: "auto", padding: "0.4rem 0" }}>
              {recent.map((s, i) =>
                posterCard(recentZ, i, label(s), s.cover_image_url, s.year ? String(s.year) : undefined, "2/3", POSTER_W, undefined, s.watch_status === "completed"),
              )}
            </div>
          </section>
        )}

        {/* Libraries */}
        {libraries.length > 0 && (
          <section style={{ marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.8rem", color: theme.text }}>{t("home.libraries")}</h2>
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
                      display: "flex",
                      alignItems: "center",
                      gap: "0.9rem",
                      background: focused ? "rgba(122,77,255,0.16)" : theme.surface,
                      border: `3px solid ${focused ? theme.accent : "transparent"}`,
                      borderRadius: theme.radius,
                      padding: "1.1rem",
                      boxShadow: focused ? "0 0 18px rgba(122,77,255,0.6)" : "none",
                    }}
                  >
                    <div style={{ color: theme.accent2, flexShrink: 0, display: "flex" }}>
                      <Icon name={lib.kind} size={30} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lib.name}</div>
                      <div style={{ fontSize: "0.78rem", color: theme.muted, marginTop: 4 }}>{t("home.titleCount", { count: lib.series_count })}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Nothing anywhere yet */}
        {data && libsLoaded && cont.length === 0 && recent.length === 0 && libraries.length === 0 && !error && (
          <div style={{ padding: "4rem 0", textAlign: "center", color: theme.muted }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: theme.text }}>
              {t("home.noContentTitle")}
            </div>
            <div style={{ fontSize: "0.9rem", marginTop: "0.6rem" }}>
              {t("home.noContentBody")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
