import React, { useEffect, useState } from "react";
import { type SeriesSummary } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { PosterCard } from "../components/PosterCard";
import { theme } from "../theme";
import { scrollFocus } from "../util";
import { useInitialFocus } from "../hooks";

interface Props {
  libraryId: number;
  onSeries: (id: number) => void;
  onBack: () => void;
}

export default function LibraryView({ libraryId, onSeries, onBack }: Props): React.JSX.Element {
  const { api } = useDevice();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api
      .listSeries(libraryId)
      .then((list) => {
        setSeries(list);
        setError(null);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, libraryId]);

  useInitialFocus(series);

  return (
    <div className="mv-app" style={{ height: "100vh", overflowY: "auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.5rem 2.5rem 0.5rem" }}>
        <button
          className="spottable mv-focusable"
          onClick={onBack}
          onFocus={scrollFocus}
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 999,
            color: theme.text,
            padding: "0.5rem 1.1rem",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          ← Vissza
        </button>
        <span style={{ fontSize: "1.4rem", fontWeight: 700 }}>Könyvtár</span>
      </header>

      <div style={{ padding: "1rem 2.5rem 3rem" }}>
        {!series && !error && <p style={{ color: theme.muted }}>Betöltés…</p>}
        {error && <p style={{ color: "#f87171" }}>Betöltési hiba: {error}</p>}
        {series && series.length === 0 && <p style={{ color: theme.muted }}>Üres könyvtár.</p>}
        {series && series.length > 0 && (
          <div
            className="mv-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              gap: "1.2rem",
            }}
          >
            {series.map((s) => (
              <PosterCard
                key={s.id}
                title={s.display_title ?? s.title}
                cover={s.cover_image_url}
                width={170}
                percent={s.watch_percent}
                watched={s.watch_status === "completed"}
                subtitle={s.year !== null ? String(s.year) : undefined}
                onSelect={() => onSeries(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
