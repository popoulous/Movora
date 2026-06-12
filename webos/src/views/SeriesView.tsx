import React, { useEffect, useState } from "react";
import { type SeriesDetail, type Library, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { scrollIntoFocus, useTvInput } from "../hooks";
import { BackButton } from "../components/BackButton";
import { TopNav, type NavTab } from "../components/TopNav";
import { Icon } from "../components/Icon";
import { theme } from "../theme";
import { aspectHeight } from "../util";

interface Props {
  seriesId: number;
  onPlay: (episodeId: number) => void;
  onSeries: (id: number) => void;
  onLibrary: (id: number) => void;
  onHome: () => void;
  onSettings: () => void;
  onBack: () => void;
}

const EP_W = 210;
const REC_W = 140;

export default function SeriesView({
  seriesId,
  onPlay,
  onSeries,
  onLibrary,
  onHome,
  onSettings,
  onBack,
}: Props): React.JSX.Element {
  const { api, config } = useDevice();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ z: number; i: number }>({ z: 1, i: 0 });

  useEffect(() => {
    if (!api) return;
    api
      .getSeries(seriesId)
      .then((s) => {
        setSeries(s);
        setError(null);
        if (s.watch?.continue_episode_id != null) {
          const idx = s.seasons.findIndex((sn) =>
            sn.episodes.some((e) => e.id === s.watch?.continue_episode_id),
          );
          if (idx >= 0) setSelectedSeason(idx);
        }
      })
      .catch((e: unknown) => setError(String(e)));
    api.getLibraries().then(setLibraries).catch(() => undefined);
  }, [api, seriesId]);

  const img = (url: string | null): string | undefined =>
    mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, url);

  const navTabs: NavTab[] = [
    { id: "home", label: "Főoldal" },
    ...libraries.map((l) => ({ id: `lib:${l.id}`, label: l.name })),
    { id: "settings", label: "Beállítások" },
  ];

  const title = series ? (series.display_title ?? series.title) : "Betöltés…";
  const seasons = series?.seasons ?? [];
  const currentSeason = seasons[Math.min(selectedSeason, seasons.length - 1)];
  const episodes = currentSeason?.episodes ?? [];
  const recs = series?.recommendations ?? [];
  const banner = img(series?.banner_image_url ?? series?.cover_image_url ?? null);

  const genres = series?.genres
    ? series.genres.split(",").map((g) => g.trim()).filter(Boolean)
    : [];
  const totalEps = seasons.reduce((n, sn) => n + sn.episodes.length, 0);

  const contId = series?.watch?.continue_episode_id ?? null;
  const firstId = seasons[0]?.episodes[0]?.id ?? null;

  // Meta line: rating · years · format · episode count · duration.
  const metaParts: string[] = [];
  if (series?.score != null) metaParts.push(`★ ${(series.score / 10).toFixed(1)}`);
  const years =
    series?.end_year != null && series.end_year !== series.year
      ? `${series.year}–${series.end_year}`
      : series?.year != null
        ? String(series.year)
        : null;
  if (years) metaParts.push(years);
  if (series?.format) metaParts.push(series.format);
  if (totalEps) metaParts.push(`${totalEps} epizód`);
  if (series?.episode_duration) metaParts.push(`${series.episode_duration} perc`);

  // Primary actions: continue (+ from start) or just play.
  const actions: { id: string; label: string; sub?: string; primary?: boolean }[] = [];
  if (contId != null) {
    let sub: string | undefined;
    for (const sn of seasons) {
      const e = sn.episodes.find((x) => x.id === contId);
      if (e) {
        sub = `${sn.number}. évad ${e.number}. rész`;
        break;
      }
    }
    actions.push({ id: "continue", label: "Folytatás", sub, primary: true });
    if (firstId != null) actions.push({ id: "restart", label: "Elölről" });
  } else if (firstId != null) {
    actions.push({ id: "play", label: "Lejátszás", primary: true });
  }

  // Focus zones, in vertical order (only those with content).
  const zones: { id: string; len: number }[] = [{ id: "nav", len: navTabs.length }];
  if (actions.length) zones.push({ id: "actions", len: actions.length });
  if (seasons.length > 1) zones.push({ id: "seasons", len: seasons.length });
  if (episodes.length) zones.push({ id: "episodes", len: episodes.length });
  if (recs.length) zones.push({ id: "recs", len: recs.length });

  const zone = zones[Math.min(focus.z, zones.length - 1)] ?? zones[0];

  const actionsZ = 1;
  const seasonsZ = 1 + (actions.length ? 1 : 0);
  const episodesZ = seasonsZ + (seasons.length > 1 ? 1 : 0);
  const recsZ = episodesZ + (episodes.length ? 1 : 0);

  // Keep the focused element in view.
  useEffect(() => {
    const el = document.querySelector(`[data-f="${focus.z}-${focus.i}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ block: "nearest", inline: "center" }); // horizontal centering
    scrollIntoFocus(el); // reliable vertical visibility (incl. the top nav)
  }, [focus]);

  const openTab = (id: string): void => {
    if (id === "home") onHome();
    else if (id === "settings") onSettings();
    else if (id.startsWith("lib:")) onLibrary(Number(id.slice(4)));
  };

  const runAction = (id: string): void => {
    if (id === "continue" && contId != null) onPlay(contId);
    else if ((id === "restart" || id === "play") && firstId != null) onPlay(firstId);
  };

  const activate = (): void => {
    if (zone.id === "nav") openTab(navTabs[focus.i].id);
    else if (zone.id === "actions") runAction(actions[focus.i].id);
    else if (zone.id === "seasons") setSelectedSeason(focus.i);
    else if (zone.id === "episodes") {
      const ep = episodes[focus.i];
      if (ep) onPlay(ep.id);
    } else if (zone.id === "recs") {
      const r = recs[focus.i];
      if (r?.target_series_id != null) onSeries(r.target_series_id);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => {
        const nz = Math.max(0, f.z - 1);
        return { z: nz, i: zones[nz]?.id === "seasons" ? selectedSeason : 0 };
      });
    } else if (k === "ArrowDown") {
      e.preventDefault();
      setFocus((f) => {
        const nz = Math.min(zones.length - 1, f.z + 1);
        return { z: nz, i: zones[nz]?.id === "seasons" ? selectedSeason : 0 };
      });
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      if (zone.id === "seasons") {
        const ni = Math.max(0, focus.i - 1);
        setFocus({ z: focus.z, i: ni });
        setSelectedSeason(ni);
      } else {
        setFocus((f) => ({ ...f, i: Math.max(0, f.i - 1) }));
      }
    } else if (k === "ArrowRight") {
      e.preventDefault();
      if (zone.id === "seasons") {
        const ni = Math.min(seasons.length - 1, focus.i + 1);
        setFocus({ z: focus.z, i: ni });
        setSelectedSeason(ni);
      } else {
        setFocus((f) => ({ ...f, i: Math.min(zone.len - 1, f.i + 1) }));
      }
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      activate();
    }
  };

  useTvInput(onKey, onBack);

  const navFocus = zone.id === "nav" ? focus.i : -1;

  return (
    <div className="mv-app" style={{ height: "100vh", overflowY: "auto", paddingBottom: "2rem" }}>
      <TopNav tabs={navTabs} activeId="" focusIdx={navFocus} onActivate={openTab} zoneIndex={0} />

      {/* Hero with right-side banner fading into the background. */}
      <div style={{ position: "relative", minHeight: 360, padding: "0 2.5rem" }}>
        {banner && (
          <>
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: "60%",
                backgroundImage: `url(${banner})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to right, #05060B 26%, rgba(5,6,11,0.55) 52%, rgba(5,6,11,0.05) 100%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 130,
                background: "linear-gradient(to top, #05060B, transparent)",
              }}
            />
          </>
        )}

        <div style={{ position: "relative", maxWidth: 840, paddingTop: "0.6rem" }}>
          <div style={{ marginBottom: "0.7rem" }}>
            <BackButton onClick={onBack} />
          </div>
          <h1 style={{ fontSize: "2.4rem", fontWeight: 800, margin: "0 0 0.5rem", color: "#fff" }}>{title}</h1>

          {metaParts.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                color: theme.muted,
                fontSize: "0.92rem",
                marginBottom: "0.6rem",
              }}
            >
              {metaParts.map((p, i) => (
                <span key={i} style={{ marginRight: "0.9rem" }}>
                  {p}
                </span>
              ))}
            </div>
          )}

          {genres.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", marginBottom: "1rem" }}>
              {genres.map((g) => (
                <span
                  key={g}
                  style={{
                    marginRight: "0.5rem",
                    marginBottom: "0.4rem",
                    padding: "0.25rem 0.85rem",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    fontSize: "0.82rem",
                    color: theme.text,
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {actions.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", marginBottom: "1.1rem" }}>
              {actions.map((a, i) => {
                const focused = zone.id === "actions" && focus.i === i;
                return (
                  <div
                    key={a.id}
                    data-f={`${actionsZ}-${i}`}
                    onClick={() => runAction(a.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      marginRight: "0.8rem",
                      padding: "0.6rem 1.3rem",
                      borderRadius: 999,
                      cursor: "pointer",
                      fontWeight: 700,
                      color: "#fff",
                      background: a.primary ? theme.gradient : "rgba(255,255,255,0.12)",
                      border: `3px solid ${focused ? "#fff" : "transparent"}`,
                      boxShadow: focused ? "0 0 18px rgba(122,77,255,0.8)" : "none",
                    }}
                  >
                    <Icon name="play" size={18} />
                    <span style={{ marginLeft: "0.5rem" }}>
                      {a.label}
                      {a.sub ? ` · ${a.sub}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {series?.description && (
            <p
              style={{
                color: theme.muted,
                fontSize: "0.9rem",
                maxWidth: 720,
                lineHeight: 1.5,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {series.description.replace(/<[^>]+>/g, "")}
            </p>
          )}
        </div>
      </div>

      {error && <p style={{ padding: "0 2.5rem", color: "#f87171" }}>Betöltési hiba: {error}</p>}

      {series && (
        <div style={{ padding: "0.6rem 2.5rem 0" }}>
          {seasons.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", marginBottom: "0.9rem" }}>
              {seasons.map((sn, i) => {
                const sel = i === selectedSeason;
                const focused = zone.id === "seasons" && focus.i === i;
                return (
                  <span
                    key={sn.id}
                    data-f={`${seasonsZ}-${i}`}
                    onClick={() => setSelectedSeason(i)}
                    style={{
                      marginRight: "0.6rem",
                      padding: "0.35rem 1rem",
                      borderRadius: 999,
                      cursor: "pointer",
                      fontWeight: sel ? 700 : 600,
                      fontSize: "0.95rem",
                      color: sel || focused ? "#fff" : theme.muted,
                      background: focused
                        ? theme.gradient
                        : sel
                          ? "rgba(122,77,255,0.22)"
                          : "rgba(255,255,255,0.06)",
                      boxShadow: focused ? "0 0 14px rgba(122,77,255,0.6)" : "none",
                    }}
                  >
                    {sn.number}. évad
                  </span>
                );
              })}
            </div>
          )}

          {/* Episode carousel */}
          <div className="mv-row" style={{ display: "flex", overflowX: "auto", paddingBottom: "0.4rem" }}>
            {episodes.map((ep, i) => {
              const focused = zone.id === "episodes" && focus.i === i;
              const isCurrent = ep.id === contId;
              const thumb = img(ep.thumbnail_url);
              const label =
                ep.end_number != null ? `${ep.number}–${ep.end_number}. rész` : `${ep.number}. rész`;
              return (
                <div
                  key={ep.id}
                  data-f={`${episodesZ}-${i}`}
                  onClick={() => onPlay(ep.id)}
                  style={{
                    width: EP_W,
                    flexShrink: 0,
                    marginRight: "0.9rem",
                    background: theme.surface,
                    border: `3px solid ${focused ? theme.accent : isCurrent ? "rgba(122,77,255,0.5)" : "transparent"}`,
                    borderRadius: theme.radius,
                    overflow: "hidden",
                    cursor: "pointer",
                    boxShadow: focused ? "0 0 18px rgba(122,77,255,0.65)" : "none",
                  }}
                >
                  <div style={{ position: "relative", width: "100%", height: aspectHeight(EP_W, "16/9"), background: "#11131f" }}>
                    {thumb && <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    {ep.device_ready !== null && (
                      <div
                        title={ep.device_ready ? "Lejátszható ezen a TV-n" : "Optimalizálás szükséges"}
                        style={{
                          position: "absolute",
                          top: 6,
                          left: 6,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: ep.device_ready ? "#4ade80" : "#fbbf24",
                          border: "2px solid rgba(5,6,11,0.6)",
                          boxShadow: `0 0 8px ${ep.device_ready ? "rgba(74,222,128,0.7)" : "rgba(251,191,36,0.7)"}`,
                        }}
                      />
                    )}
                    {ep.watched && (
                      <div
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "rgba(5,6,11,0.7)",
                          color: "#4ade80",
                          fontSize: "0.8rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "0.5rem 0.6rem" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: ep.watched ? theme.muted : theme.text }}>
                      {label}
                    </div>
                    {ep.title && (
                      <div style={{ fontSize: "0.72rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ep.title}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recommendations */}
          {recs.length > 0 && (
            <section style={{ marginTop: "1.6rem" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.7rem", color: theme.text }}>
                Neked ajánljuk
              </h2>
              <div className="mv-row" style={{ display: "flex", overflowX: "auto", paddingBottom: "0.4rem" }}>
                {recs.map((r, i) => {
                  const focused = zone.id === "recs" && focus.i === i;
                  const cover = img(r.cover_image_url);
                  const clickable = r.target_series_id != null;
                  return (
                    <div
                      key={i}
                      data-f={`${recsZ}-${i}`}
                      onClick={() => {
                        if (r.target_series_id != null) onSeries(r.target_series_id);
                      }}
                      style={{
                        width: REC_W,
                        flexShrink: 0,
                        marginRight: "0.9rem",
                        background: theme.surface,
                        border: `3px solid ${focused ? theme.accent : "transparent"}`,
                        borderRadius: theme.radius,
                        overflow: "hidden",
                        cursor: clickable ? "pointer" : "default",
                        opacity: clickable ? 1 : 0.6,
                        boxShadow: focused ? "0 0 18px rgba(122,77,255,0.6)" : "none",
                      }}
                    >
                      <div style={{ width: "100%", height: aspectHeight(REC_W, "2/3"), background: "#11131f" }}>
                        {cover && <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                      </div>
                      <div style={{ padding: "0.4rem 0.5rem" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.title}
                        </div>
                        {r.score != null && (
                          <div style={{ fontSize: "0.7rem", color: theme.muted }}>★ {(r.score / 10).toFixed(1)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
