import React from "react";
import { mediaUrl } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { theme } from "../theme";

interface Props {
  title: string;
  cover: string | null;
  subtitle?: string;
  percent?: number; // 0-100 watch progress bar, when > 0
  watched?: boolean;
  aspect?: "2/3" | "16/9";
  width?: number;
  onSelect: () => void;
}

export function PosterCard({
  title,
  cover,
  subtitle,
  percent = 0,
  watched = false,
  aspect = "2/3",
  width = 170,
  onSelect,
}: Props): React.JSX.Element {
  const { config } = useDevice();
  const img = mediaUrl(config?.serverUrl ?? "", config?.deviceToken ?? null, cover);

  return (
    <button
      className="mv-focusable"
      onClick={onSelect}
      style={{
        width,
        flexShrink: 0,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        textAlign: "left",
        color: theme.text,
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: aspect, background: "#11131f" }}>
        {img ? (
          <img
            src={img}
            alt={title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.muted,
              fontSize: "0.75rem",
              padding: "0.5rem",
              textAlign: "center",
            }}
          >
            {title}
          </div>
        )}
        {watched && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: theme.gradient,
              color: "#fff",
              borderRadius: 999,
              fontSize: "0.7rem",
              padding: "2px 8px",
              fontWeight: 700,
            }}
          >
            ✓
          </span>
        )}
        {percent > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 4,
              background: "rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ width: `${percent}%`, height: "100%", background: theme.gradient }} />
          </div>
        )}
      </div>
      <div style={{ padding: "0.5rem 0.6rem" }}>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: "0.72rem",
              color: theme.muted,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}
