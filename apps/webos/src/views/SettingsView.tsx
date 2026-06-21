/* eslint-disable react/jsx-no-bind -- inline handlers are idiomatic for this list-heavy TV UI */
import React, { useEffect, useState } from "react";
import { scrollIntoFocus, useTvInput } from "../hooks";
import { useDevice } from "../context/DeviceContext";
import { useI18n, LANGS, LANG_NAMES } from "../i18n";
import { theme } from "../theme";
import { Icon } from "../components/Icon";
import { BackButton } from "../components/BackButton";
import { discoverServer } from "../discovery";

interface Props {
  onBack: () => void;
  onCapability: () => void;
}

const VERSION = "v0.1.0";

// Focus order: Back, the language row (◀▶ switches), then the action buttons stacked
// top-to-bottom. The X mirrors Back.
const FOCUS_BACK = 0;
const FOCUS_LANG = 1;
const FOCUS_RESCAN = 2;
const FOCUS_UNPAIR = 3;
const FOCUS_CAP = 4;
const FOCUS_LAST = FOCUS_CAP;

function infoRowIcon(name: string): React.JSX.Element {
  return (
    <span
      style={{
        width: 52,
        height: 52,
        flexShrink: 0,
        borderRadius: "50%",
        background: "rgba(168,85,247,0.14)",
        border: "1px solid rgba(168,85,247,0.32)",
        color: "#c084fc",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={26} />
    </span>
  );
}

function InfoRow({
  icon,
  label,
  value,
  accent,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0.7rem 0" }}>
      {infoRowIcon(icon)}
      <div style={{ marginLeft: "1.1rem", minWidth: 0 }}>
        <div style={{ fontSize: "0.95rem", color: theme.muted, marginBottom: "0.15rem" }}>{label}</div>
        <div
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: accent ? "#c084fc" : "#fff",
            fontFamily: mono ? "monospace" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function actionStyle(focused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
    width: "100%",
    boxSizing: "border-box", // include padding + border so it doesn't overflow the card
    height: 78,
    padding: "0 1.4rem",
    borderRadius: 18,
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "#fff",
    background: focused ? "rgba(122,77,255,0.22)" : "rgba(255,255,255,0.05)",
    border: focused ? `2px solid ${theme.accent}` : "1px solid rgba(168,85,247,0.22)",
    boxShadow: focused ? "0 0 0 4px rgba(168,85,247,0.28), 0 0 26px rgba(122,77,255,0.4)" : "none",
    transform: focused ? "scale(1.02)" : "scale(1)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
    cursor: "pointer",
  };
}

function ServerArt(): React.JSX.Element {
  // Decorative only (non-interactive): a server + TV linked over the network, on a
  // faint neon panel. Pure SVG so it stays crisp and dependency-free.
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        marginLeft: "2rem",
        borderRadius: 28,
        border: "1px solid rgba(168,85,247,0.18)",
        background: "radial-gradient(circle at 60% 30%, rgba(124,58,237,0.20) 0%, rgba(10,10,22,0.0) 60%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <svg width="320" height="320" viewBox="0 0 320 320" aria-hidden="true">
        <defs>
          <linearGradient id="mv-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a1d6e" />
            <stop offset="1" stopColor="#0b0b1a" />
          </linearGradient>
        </defs>
        <circle cx="160" cy="120" r="92" fill="url(#mv-sky)" opacity="0.5" />
        {/* network nodes */}
        <g stroke="#a855f7" strokeWidth="2" opacity="0.55">
          <line x1="110" y1="120" x2="210" y2="120" />
          <line x1="160" y1="70" x2="160" y2="200" />
        </g>
        <g fill="#c084fc">
          <circle cx="110" cy="120" r="6" />
          <circle cx="210" cy="120" r="6" />
          <circle cx="160" cy="70" r="6" />
        </g>
        {/* server tower */}
        <g transform="translate(124,150)">
          <rect x="0" y="0" width="44" height="92" rx="8" fill="#16162b" stroke="#7A4DFF" strokeWidth="2" />
          <g fill="#c084fc">
            <circle cx="12" cy="16" r="4" />
            <rect x="22" y="13" width="14" height="5" rx="2" opacity="0.7" />
            <circle cx="12" cy="36" r="4" />
            <rect x="22" y="33" width="14" height="5" rx="2" opacity="0.7" />
            <circle cx="12" cy="56" r="4" />
            <rect x="22" y="53" width="14" height="5" rx="2" opacity="0.7" />
          </g>
        </g>
        {/* TV */}
        <g transform="translate(196,196)" fill="none" stroke="#EC4899" strokeWidth="2.4" strokeLinejoin="round">
          <rect x="0" y="0" width="64" height="40" rx="5" fill="rgba(236,72,153,0.10)" />
          <path d="M22 50h20M32 40v10" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

export default function SettingsView({ onBack, onCapability }: Props): React.JSX.Element {
  const { config, save, clear } = useDevice();
  const { t, lang, setLang } = useI18n();
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(FOCUS_BACK);

  const handleUnpair = (): void => {
    clear();
    onBack();
  };

  const handleRescan = (): void => {
    setRescanning(true);
    setRescanMsg(null);
    void discoverServer().then((res) => {
      setRescanning(false);
      if (res.serverUrl !== null && config !== null) {
        save({ ...config, serverUrl: res.serverUrl });
        setRescanMsg(t("settings.serverUpdated", { url: res.serverUrl }));
      } else if (res.ip === null) {
        setRescanMsg(t("settings.ipFail"));
      } else {
        setRescanMsg(t("settings.noServerFound"));
      }
    });
  };

  const cycleLang = (dir: number): void => {
    const idx = LANGS.indexOf(lang);
    const next = LANGS[Math.max(0, Math.min(LANGS.length - 1, idx + dir))];
    if (next !== lang) setLang(next);
  };

  const activate = (index: number): void => {
    if (index === FOCUS_BACK) onBack();
    else if (index === FOCUS_RESCAN) handleRescan();
    else if (index === FOCUS_UNPAIR) handleUnpair();
    else if (index === FOCUS_CAP) onCapability();
    // FOCUS_LANG is changed with ◀▶, so Enter on it does nothing.
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === "ArrowDown") {
      e.preventDefault();
      setFocus(Math.min(focus + 1, FOCUS_LAST));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      setFocus(Math.max(focus - 1, FOCUS_BACK));
    } else if (k === "ArrowLeft" && focus === FOCUS_LANG) {
      e.preventDefault();
      cycleLang(-1);
    } else if (k === "ArrowRight" && focus === FOCUS_LANG) {
      e.preventDefault();
      cycleLang(1);
    } else if (k === "Enter") {
      e.preventDefault();
      activate(focus);
    }
  };
  useTvInput(onKey, onBack);

  // Keep the focused control in view when navigating with the D-pad on short screens.
  useEffect(() => {
    const el = document.querySelector(`[data-sf="${focus}"]`);
    if (el instanceof HTMLElement) scrollIntoFocus(el, 90, 90);
  }, [focus]);

  const token = config?.deviceToken ? `${config.deviceToken.slice(0, 12)}…` : "–";
  const backFocused = focus === FOCUS_BACK;

  return (
    <div
      className="mv-app"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "radial-gradient(circle at 78% 30%, #14102b 0%, #05060B 58%)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto", // scroll on short viewports instead of clipping the buttons
        padding: "3rem 3.5rem",
        color: "#fff",
      }}
    >
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "2.2rem" }}>
        <BackButton focused={backFocused} onClick={onBack} dataSf="0" />
        <h1 style={{ margin: "0 0 0 1.4rem", fontSize: "2.6rem", fontWeight: 800 }}>{t("settings.title")}</h1>
        <span
          onClick={onBack}
          style={{
            marginLeft: "auto",
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: theme.muted,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="close" size={24} />
        </span>
      </div>

      {/* Content: card + decorative art */}
      <div style={{ display: "flex", flex: "1 0 auto", minHeight: 0 }}>
        <div
          style={{
            width: "62%",
            borderRadius: 30,
            background: "rgba(15,18,32,0.82)",
            border: "1px solid rgba(168,85,247,0.35)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45), inset 0 0 40px rgba(122,77,255,0.06)",
            padding: "1.8rem 2rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <InfoRow icon="globe" label={t("settings.serverUrl")} value={config?.serverUrl ?? "–"} accent />
          <InfoRow icon="monitor" label={t("settings.deviceName")} value={config?.deviceName ?? "–"} />
          <InfoRow icon="key" label={t("settings.token")} value={token} mono />

          {/* Language selector — the row is focusable; ◀▶ switches, applied instantly. */}
          <div
            data-sf="1"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0.7rem 0.6rem",
              marginTop: "0.4rem",
              borderRadius: 16,
              boxSizing: "border-box",
              border: focus === FOCUS_LANG ? `2px solid ${theme.accent}` : "2px solid transparent",
              background: focus === FOCUS_LANG ? "rgba(122,77,255,0.12)" : "transparent",
              boxShadow: focus === FOCUS_LANG ? "0 0 0 4px rgba(168,85,247,0.22)" : "none",
              transition: "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease",
            }}
          >
            {infoRowIcon("globe")}
            <div style={{ marginLeft: "1.1rem", minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "0.95rem", color: theme.muted, marginBottom: "0.45rem" }}>{t("settings.language")}</div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {LANGS.map((l) => {
                  const selected = l === lang;
                  return (
                    <span
                      key={l}
                      onClick={() => {
                        setFocus(FOCUS_LANG);
                        setLang(l);
                      }}
                      style={{
                        marginRight: "0.5rem",
                        marginBottom: "0.4rem",
                        padding: "0.32rem 0.95rem",
                        borderRadius: 999,
                        fontSize: "0.95rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        color: selected ? "#fff" : theme.muted,
                        background: selected ? theme.gradient : "rgba(255,255,255,0.06)",
                        boxShadow: selected && focus === FOCUS_LANG ? "0 0 14px rgba(122,77,255,0.6)" : "none",
                      }}
                    >
                      {LANG_NAMES[l]}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "1.4rem" }}>
            <div data-sf="2" style={actionStyle(focus === FOCUS_RESCAN)} onClick={() => { setFocus(FOCUS_RESCAN); handleRescan(); }}>
              <Icon name="refresh" size={24} />
              {rescanning ? t("settings.rescanning") : t("settings.rescan")}
            </div>
            <div data-sf="3" style={actionStyle(focus === FOCUS_UNPAIR)} onClick={() => { setFocus(FOCUS_UNPAIR); handleUnpair(); }}>
              <Icon name="unlink" size={24} />
              {t("settings.unpair")}
            </div>
            <div data-sf="4" style={actionStyle(focus === FOCUS_CAP)} onClick={() => { setFocus(FOCUS_CAP); onCapability(); }}>
              <Icon name="settings" size={24} />
              {t("settings.capabilityTest")}
            </div>
          </div>

          {rescanMsg !== null && (
            <p style={{ margin: "1rem 0 0", fontSize: "0.95rem", color: "#c084fc" }}>{rescanMsg}</p>
          )}
          <p style={{ margin: "0.9rem 0 0", fontSize: "0.92rem", lineHeight: 1.5, color: theme.muted }}>
            {t("settings.helpText")}
          </p>
        </div>

        <ServerArt />
      </div>

      {/* Version card */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "1.6rem", color: theme.muted, fontSize: "0.9rem" }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: theme.gradient,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.95rem",
            fontWeight: 900,
            color: "#fff",
          }}
        >
          M
        </span>
        {t("settings.clientVersion", { version: VERSION })}
      </div>
    </div>
  );
}
