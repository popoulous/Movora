import React, { useEffect, useState } from "react";
import { Panel, Header } from "@enact/sandstone/Panels";
import Button from "@enact/sandstone/Button";
import Spinner from "@enact/sandstone/Spinner";
import Scroller from "@enact/sandstone/Scroller";
import { type SeriesDetail, type Episode } from "../api/client";
import { useDevice } from "../context/DeviceContext";

interface Props {
  seriesId: number;
  onPlay: (episodeId: number) => void;
  onBack: () => void;
}

function EpisodeRow({
  ep,
  onPlay,
}: {
  ep: Episode;
  onPlay: () => void;
}): React.JSX.Element {
  const label =
    ep.end_number !== null ? `${ep.number}–${ep.end_number}. rész` : `${ep.number}. rész`;
  return (
    <button
      onClick={onPlay}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        background: ep.watched ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)",
        border: "none",
        borderRadius: 6,
        marginBottom: "0.5rem",
        padding: "0.75rem 1rem",
        cursor: "pointer",
        textAlign: "left",
        color: ep.watched ? "#888" : "#f0f0f0",
      }}
    >
      {ep.thumbnail_url && (
        <img
          src={ep.thumbnail_url}
          alt=""
          style={{ width: 120, aspectRatio: "16/9", objectFit: "cover", borderRadius: 4, marginRight: "1rem" }}
        />
      )}
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{label}</div>
        {ep.title && (
          <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: 2 }}>{ep.title}</div>
        )}
        {ep.watched && (
          <div style={{ fontSize: "0.7rem", color: "#4ade80", marginTop: 2 }}>✓ Megnézve</div>
        )}
      </div>
    </button>
  );
}

export default function SeriesView({ seriesId, onPlay, onBack }: Props): React.JSX.Element {
  const { api } = useDevice();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api
      .getSeries(seriesId)
      .then((s) => {
        setSeries(s);
        setError(null);
        // Pre-select the season with the continue episode if present.
        if (s.watch?.continue_episode_id !== null) {
          const idx = s.seasons.findIndex((sn) =>
            sn.episodes.some((e) => e.id === s.watch?.continue_episode_id),
          );
          if (idx >= 0) setSelectedSeason(idx);
        }
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, seriesId]);

  const title = series ? (series.display_title ?? series.title) : "Betöltés…";
  const currentSeason = series?.seasons[selectedSeason];

  return (
    <Panel>
      <Header
        title={title}
        subtitle={series?.year?.toString()}
        slotBefore={
          <Button size="small" onClick={onBack}>
            ←
          </Button>
        }
      />
      {!series && !error && <Spinner component="div" />}
      {error && (
        <p style={{ padding: "2rem", color: "#f87171" }}>Betöltési hiba: {error}</p>
      )}
      {series && (
        <div style={{ display: "flex", height: "calc(100vh - 120px)" }}>
          {/* Season selector */}
          <div
            style={{
              width: 160,
              padding: "1rem",
              borderRight: "1px solid rgba(255,255,255,0.1)",
              flexShrink: 0,
            }}
          >
            {series.seasons.map((sn, i) => (
              <button
                key={sn.id}
                onClick={() => setSelectedSeason(i)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "0.6rem 0.8rem",
                  marginBottom: "0.3rem",
                  background:
                    i === selectedSeason ? "rgba(192,132,252,0.25)" : "transparent",
                  border: i === selectedSeason ? "1px solid #c084fc" : "1px solid transparent",
                  borderRadius: 6,
                  color: i === selectedSeason ? "#c084fc" : "#d0d0e0",
                  cursor: "pointer",
                  fontWeight: i === selectedSeason ? 700 : 400,
                }}
              >
                {sn.number}. évad
              </button>
            ))}
          </div>

          {/* Episode list */}
          <Scroller style={{ flex: 1 }}>
            <div style={{ padding: "1rem" }}>
              {currentSeason?.episodes.map((ep) => (
                <EpisodeRow key={ep.id} ep={ep} onPlay={() => onPlay(ep.id)} />
              ))}
            </div>
          </Scroller>
        </div>
      )}
    </Panel>
  );
}
