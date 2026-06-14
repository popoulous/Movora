import React from "react";
import { theme } from "../theme";
import { useI18n } from "../i18n";

// One shared back control for the whole app — the minimal "← Back" from the
// capability/series views. `focused` brightens it into a pill where Back is a D-pad
// target (e.g. Settings); elsewhere it stays plain muted text and the remote Back key
// handles it. `dataSf` lets a view tag it for scroll-into-focus.
export function BackButton({
  focused = false,
  onClick,
  dataSf,
}: {
  focused?: boolean;
  onClick?: () => void;
  dataSf?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      data-sf={dataSf}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "0.95rem",
        fontWeight: 600,
        color: focused ? "#fff" : theme.muted,
        background: focused ? "rgba(122,77,255,0.2)" : "transparent",
        border: `1px solid ${focused ? theme.accent : "transparent"}`,
        borderRadius: 999,
        padding: "0.3rem 0.85rem",
        cursor: "pointer",
        transition: "color 120ms ease, background 120ms ease, border-color 120ms ease",
      }}
    >
      ← {t("common.back")}
    </span>
  );
}
