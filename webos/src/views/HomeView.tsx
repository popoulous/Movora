import React, { useEffect, useState } from "react";
import { type HomeData, type HomeSeries, type Library } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { PosterCard } from "../components/PosterCard";
import { theme } from "../theme";

interface Props {
  onSeries: (id: number) => void;
  onLibrary: (id: number) => void;
  onSettings: () => void;
}

const KIND_ICON: Record<string, string> = { anime: "✦", movie: "🎬", series: "📺" };

function Row({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.9rem", color: theme.text }}>
        {title}
      </h2>
      <div className="mv-row" style={{ display: "flex", gap: "1rem", overflowX: "auto", padding: "0.5rem 0.25rem" }}>
        {children}
      </div>
    </section>
  );
}

export default function HomeView({ onSeries, onLibrary, onSettings }: Props): React.JSX.Element {
  const { api } = useDevice();
  const [data, setData] = useState<HomeData | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api.getHome().then(setData).catch((e: unknown) => setError(String(e)));
    api.getLibraries().then(setLibraries).catch(() => undefined);
  }, [api]);

  const seriesLabel = (s: HomeSeries): string => s.display_title ?? s.title;

  return (
    <div className="mv-app" style={{ minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1.5rem 2.5rem 0.5rem",
        }}
      >
        <span style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          <span style={{
            background: theme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Movora</span>
        </span>
        <button
          className="mv-focusable"
          onClick={onSettings}
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 999,
            color: theme.text,
            padding: "0.5rem 1rem",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          ⚙ Beállítások
        </button>
      </header>

      <div style={{ padding: "1rem 2.5rem 3rem" }}>
        {!data && !error && <p style={{ color: theme.muted }}>Betöltés…</p>}
        {error && <p style={{ color: "#f87171" }}>Betöltési hiba: {error}</p>}

        {data && data.continue_watching.length > 0 && (
          <Row title="Folytatás">
            {data.continue_watching.map((s) => (
              <PosterCard
                key={s.id}
                title={seriesLabel(s)}
                cover={s.continue_thumbnail_url ?? s.cover_image_url}
                aspect="16/9"
                width={300}
                percent={s.continue_percent}
                subtitle={
                  s.continue_season_number !== null
                    ? `${s.continue_season_number}. évad · ${s.continue_episode_number}. rész`
                    : undefined
                }
                onSelect={() => onSeries(s.id)}
              />
            ))}
          </Row>
        )}

        {data && data.recently_added.length > 0 && (
          <Row title="Nemrég hozzáadva">
            {data.recently_added.map((s) => (
              <PosterCard
                key={s.id}
                title={seriesLabel(s)}
                cover={s.cover_image_url}
                onSelect={() => onSeries(s.id)}
              />
            ))}
          </Row>
        )}

        {libraries.length > 0 && (
          <Row title="Könyvtárak">
            {libraries.map((lib) => (
              <button
                key={lib.id}
                className="mv-focusable"
                onClick={() => onLibrary(lib.id)}
                style={{
                  width: 220,
                  flexShrink: 0,
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius,
                  padding: "1.5rem 1rem",
                  cursor: "pointer",
                  textAlign: "left",
                  color: theme.text,
                }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
                  {KIND_ICON[lib.kind] ?? "📁"}
                </div>
                <div style={{ fontSize: "1rem", fontWeight: 700 }}>{lib.name}</div>
                <div style={{ fontSize: "0.78rem", color: theme.muted, marginTop: 2 }}>
                  {lib.series_count} cím
                </div>
              </button>
            ))}
          </Row>
        )}

        {data && data.recently_finished.length > 0 && (
          <Row title="Nemrég befejezve">
            {data.recently_finished.map((s) => (
              <PosterCard
                key={s.id}
                title={seriesLabel(s)}
                cover={s.cover_image_url}
                watched
                onSelect={() => onSeries(s.id)}
              />
            ))}
          </Row>
        )}
      </div>
    </div>
  );
}
