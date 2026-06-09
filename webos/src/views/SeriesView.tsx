import React, { useEffect, useState } from "react";
import { type SeriesDetail, type Episode, mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";
import { aspectHeight, scrollFocus } from "../util";
import { useInitialFocus } from "../hooks";

const THUMB_W = 132;
const THUMB_H = aspectHeight(THUMB_W, "16/9");

interface Props {
  seriesId: number;
  onPlay: (episodeId: number) => void;
  onBack: () => void;
}

function EpisodeRow({ ep, onPlay }: { ep: Episode; onPlay: () => void }): React.JSX.Element {
  const { config } = useDevice();
  const thumb = mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, ep.thumbnail_url);
  const label =
    ep.end_number !== null ? `${ep.number}–${ep.end_number}. rész` : `${ep.number}. rész`;
  return (
    <button
      className="spottable mv-focusable"
      onClick={onPlay}
      onFocus={scrollFocus}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        width: "100%",
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius,
        marginBottom: "0.6rem",
        padding: "0.6rem 0.8rem",
        cursor: "pointer",
        textAlign: "left",
        color: ep.watched ? theme.muted : theme.text,
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          style={{ width: THUMB_W, height: THUMB_H, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: THUMB_W, height: THUMB_H, borderRadius: 8, background: "#11131f", flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          {label}
          {ep.watched && <span style={{ color: "#4ade80", marginLeft: 8, fontSize: "0.8rem" }}>✓</span>}
        </div>
        {ep.title && (
          <div style={{ fontSize: "0.82rem", color: theme.muted, marginTop: 2 }}>{ep.title}</div>
        )}
      </div>
    </button>
  );
}

export default function SeriesView({ seriesId, onPlay, onBack }: Props): React.JSX.Element {
  const { api, config } = useDevice();
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
        if (s.watch?.continue_episode_id != null) {
          const idx = s.seasons.findIndex((sn) =>
            sn.episodes.some((e) => e.id === s.watch?.continue_episode_id),
          );
          if (idx >= 0) setSelectedSeason(idx);
        }
      })
      .catch((e: unknown) => setError(String(e)));
  }, [api, seriesId]);

  useInitialFocus(series);

  const title = series ? (series.display_title ?? series.title) : "Betöltés…";
  const currentSeason = series?.seasons[selectedSeason];
  const banner = mediaUrl(
    config?.serverUrl ?? "",
    config?.deviceToken ?? null,
    series?.banner_image_url ?? series?.cover_image_url ?? null,
  );

  return (
    <div className="mv-app" style={{ height: "100vh", overflowY: "auto" }}>
      {/* Hero */}
      <div style={{ position: "relative", padding: "1.5rem 2.5rem 1rem" }}>
        {banner && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${banner})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.18,
              filter: "blur(2px)",
            }}
          />
        )}
        <div style={{ position: "relative" }}>
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
          <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: "1rem 0 0.3rem" }}>{title}</h1>
          <div style={{ color: theme.muted, fontSize: "0.9rem" }}>
            {[series?.year, series?.format, series?.score ? `★ ${series.score}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {series?.description && (
            <p
              style={{
                color: theme.muted,
                fontSize: "0.9rem",
                maxWidth: 760,
                marginTop: "0.8rem",
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
        <div style={{ display: "flex", gap: "1.5rem", padding: "0.5rem 2.5rem 3rem" }}>
          {/* Season selector */}
          {series.seasons.length > 1 && (
            <div style={{ width: 150, flexShrink: 0 }}>
              {series.seasons.map((sn, i) => (
                <button
                  key={sn.id}
                  className="spottable mv-focusable"
                  onClick={() => setSelectedSeason(i)}
                  onFocus={scrollFocus}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.6rem 0.8rem",
                    marginBottom: "0.4rem",
                    background: i === selectedSeason ? "rgba(122,77,255,0.25)" : theme.surface,
                    border: `1px solid ${i === selectedSeason ? theme.accent : theme.border}`,
                    borderRadius: theme.radius,
                    color: i === selectedSeason ? "#fff" : theme.text,
                    cursor: "pointer",
                    fontWeight: i === selectedSeason ? 700 : 400,
                    textAlign: "left",
                  }}
                >
                  {sn.number}. évad
                </button>
              ))}
            </div>
          )}

          {/* Episode list */}
          <div className="mv-grid" style={{ flex: 1, minWidth: 0 }}>
            {currentSeason?.episodes.map((ep) => (
              <EpisodeRow key={ep.id} ep={ep} onPlay={() => onPlay(ep.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
