import React, { useEffect, useState } from "react";
import { Panel, Header } from "@enact/sandstone/Panels";
import Button from "@enact/sandstone/Button";
import Spinner from "@enact/sandstone/Spinner";
import Scroller from "@enact/sandstone/Scroller";
import { type HomeData, type HomeSeries } from "../api/client";
import { useDevice } from "../context/DeviceContext";

interface Props {
  onSeries: (id: number) => void;
  onSettings: () => void;
}

function SeriesCard({
  series,
  onSelect,
}: {
  series: HomeSeries;
  onSelect: () => void;
}): React.JSX.Element {
  const label = series.display_title ?? series.title;
  const thumb = series.continue_thumbnail_url ?? series.cover_image_url;

  return (
    <button
      onClick={onSelect}
      style={{
        width: 200,
        marginRight: "1rem",
        background: "rgba(255,255,255,0.06)",
        border: "2px solid transparent",
        borderRadius: 8,
        padding: 0,
        cursor: "pointer",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={label}
          style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "16/9",
            background: "#1a1a2e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#666",
            fontSize: "0.75rem",
          }}
        >
          Nincs kép
        </div>
      )}
      <div style={{ padding: "0.5rem", textAlign: "left" }}>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "#f0f0f0",
          }}
        >
          {label}
        </div>
        {series.continue_season_number !== null && (
          <div style={{ fontSize: "0.7rem", color: "#a0a0b0", marginTop: 2 }}>
            {series.continue_season_number}. évad · {series.continue_episode_number}. ep
          </div>
        )}
      </div>
    </button>
  );
}

function Row({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: HomeSeries[];
  onSelect: (id: number) => void;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem", color: "#d4d4f0" }}>
        {title}
      </h2>
      <div style={{ display: "flex", overflowX: "auto", paddingBottom: "0.5rem" }}>
        {items.map((s) => (
          <SeriesCard key={s.id} series={s} onSelect={() => onSelect(s.id)} />
        ))}
      </div>
    </section>
  );
}

export default function HomeView({ onSeries, onSettings }: Props): React.JSX.Element {
  const { api } = useDevice();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api
      .getHome()
      .then(setData)
      .catch((e: unknown) => setError(String(e)));
  }, [api]);

  return (
    <Panel>
      <Header
        title="Movora"
        slotAfter={
          <Button size="small" onClick={onSettings}>
            ⚙
          </Button>
        }
      />
      <Scroller style={{ height: "calc(100vh - 120px)" }}>
        <div style={{ padding: "1rem 2rem" }}>
          {!data && !error && <Spinner component="div" />}
          {error && <p style={{ color: "#f87171" }}>Betöltési hiba: {error}</p>}
          {data && (
            <>
              <Row title="Folytatás" items={data.continue_watching} onSelect={onSeries} />
              <Row title="Nemrég hozzáadva" items={data.recently_added} onSelect={onSeries} />
              <Row title="Nemrég befejezve" items={data.recently_finished} onSelect={onSeries} />
            </>
          )}
        </div>
      </Scroller>
    </Panel>
  );
}
