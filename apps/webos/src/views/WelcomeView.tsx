import React, { useEffect, useRef, useState } from "react";
import { Panel } from "@enact/sandstone/Panels";
import InputBase from "@enact/sandstone/Input";
import Spinner from "@enact/sandstone/Spinner";
import SpottableBase from "@enact/spotlight/Spottable";

// Enact Input's actual onChange passes {value}, not a DOM event — override the type.
const Input = InputBase as unknown as React.ComponentType<{
  value: string;
  onChange: (e: { value: string }) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}>;
// A Spotlight-focusable <div> so the buttons match the Movora look (gradient pill + glow)
// while still being 5-way navigable next to the Sandstone Input.
const Focusable = SpottableBase("div") as unknown as React.ComponentType<{
  onClick?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;
import logo from "../assets/movora_logo.png";
import { createApiClient, type PairStart } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useI18n } from "../i18n";
import { discoverServer } from "../discovery";
import { theme } from "../theme";

type Step = "discover" | "url" | "name" | "pairing" | "error";

interface Props {
  onDone: () => void;
}

// webOS Chrome 79 renders -webkit-background-clip:text, so the wordmark/code can be gradient.
const gradientText: React.CSSProperties = {
  background: theme.gradient,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

function GButton({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "inline-block",
        margin: "0 0.4rem",
        padding: "0.7rem 1.7rem",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: "1rem",
        color: "#fff",
        cursor: "pointer",
        background: primary ? theme.gradient : "rgba(255,255,255,0.1)",
        border: `2px solid ${focused ? "#fff" : "transparent"}`,
        boxShadow: focused ? "0 0 18px rgba(122,77,255,0.8)" : "none",
      }}
    >
      {label}
    </Focusable>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Panel>
      {/* Full-screen Movora backdrop (fixed layers so the Sandstone panel chrome is covered). */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: theme.bg, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-25%", left: "-15%", width: "70%", height: "70%", background: "radial-gradient(circle, rgba(122,77,255,0.22), transparent 60%)" }} />
        <div style={{ position: "absolute", bottom: "-25%", right: "-15%", width: "70%", height: "70%", background: "radial-gradient(circle, rgba(236,72,153,0.18), transparent 60%)" }} />
      </div>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          boxSizing: "border-box",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", marginBottom: "2.2rem", padding: "0.4rem 0.2rem" }}>
          <img src={logo} alt="" style={{ width: 56, height: 56, marginRight: "0.2rem" }} />
          <span style={{ fontSize: "2.2rem", fontWeight: 800, letterSpacing: "0.14em", color: "#fff", lineHeight: 1.25 }}>MOVORA</span>
        </div>
        <div
          style={{
            width: "100%",
            maxWidth: 720,
            background: theme.surfaceStrong,
            border: `1px solid ${theme.border}`,
            borderRadius: 20,
            padding: "2.5rem 2.5rem 2.8rem",
            textAlign: "center",
            boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontSize: "1.55rem", fontWeight: 800, color: "#fff", margin: "0 0 0.4rem" }}>{title}</h1>
          {subtitle ? (
            <p style={{ color: theme.muted, fontSize: "0.95rem", margin: "0 0 1.6rem", lineHeight: 1.5 }}>{subtitle}</p>
          ) : null}
          {children}
        </div>
      </div>
    </Panel>
  );
}

export default function WelcomeView({ onDone }: Props): React.JSX.Element {
  const { save } = useDevice();
  const { t } = useI18n();

  const [step, setStep] = useState<Step>("discover");
  const [scanning, setScanning] = useState(true);
  const [scanIp, setScanIp] = useState<string | null>(null);
  const [scanPct, setScanPct] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [serverUrl, setServerUrl] = useState("http://");
  const [deviceName, setDeviceName] = useState(() => t("welcome.defaultDeviceName"));
  const [pairInfo, setPairInfo] = useState<PairStart | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    },
    [],
  );

  // Network sweep. Re-runs whenever `attempt` changes (mount + the rescan button).
  // All state writes happen in async continuations, never synchronously here.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await discoverServer((p) => {
        if (!cancelled) setScanPct(Math.round((p.checked / p.total) * 100));
      });
      if (cancelled) return;
      setScanIp(result.ip);
      setScanning(false);
      if (result.serverUrl !== null) {
        setServerUrl(result.serverUrl);
        setStep("name");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function rescan(): void {
    setScanning(true);
    setScanPct(0);
    setScanIp(null);
    setStep("discover");
    setAttempt((a) => a + 1);
  }

  function handleUrlNext(): void {
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url.startsWith("http")) {
      setErrorMsg(t("welcome.urlScheme"));
      setStep("error");
      return;
    }
    setServerUrl(url);
    setStep("name");
  }

  async function handleStartPairing(): Promise<void> {
    const client = createApiClient(serverUrl, null);
    try {
      const info = await client.pairStart(deviceName);
      setPairInfo(info);
      setStep("pairing");
      startPolling(info.code);
    } catch {
      setErrorMsg(t("welcome.pairStartFail"));
      setStep("error");
    }
  }

  function startPolling(code: string): void {
    const client = createApiClient(serverUrl, null);
    pollRef.current = setInterval(() => {
      void client
        .pairStatus(code)
        .then((res) => {
          if (res.status === "approved" && res.device_token) {
            clearInterval(pollRef.current!);
            save({ serverUrl, deviceToken: res.device_token, deviceName });
            onDone();
          } else if (res.status === "expired") {
            clearInterval(pollRef.current!);
            setErrorMsg(t("welcome.codeExpired"));
            setStep("error");
          }
        })
        .catch(() => {
          // Ignore transient fetch errors while polling.
        });
    }, 3000);
  }

  const inputStyle: React.CSSProperties = { marginBottom: "1.6rem", width: "100%" };

  if (step === "discover" && scanning) {
    return (
      <Shell title={t("welcome.searching")}>
        <Spinner component="div" />
        <p style={{ marginTop: "1.4rem", color: theme.muted }}>
          {scanIp !== null
            ? t("welcome.tvAddress", { ip: scanIp, percent: scanPct })
            : t("welcome.determiningAddress")}
        </p>
      </Shell>
    );
  }

  if (step === "discover") {
    // Sweep finished without a hit.
    const subnet = scanIp !== null ? scanIp.replace(/\.\d+$/, "") : null;
    return (
      <Shell
        title={t("welcome.noServerTitle")}
        subtitle={scanIp === null ? t("welcome.noIpBody") : t("welcome.noServerBody", { subnet: subnet ?? "" })}
      >
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
          <GButton label={t("welcome.rescan")} onClick={rescan} primary />
          <GButton label={t("welcome.manualEntry")} onClick={() => setStep("url")} />
        </div>
      </Shell>
    );
  }

  if (step === "url") {
    return (
      <Shell title={t("welcome.enterUrl")}>
        <Input
          value={serverUrl}
          onChange={({ value }) => setServerUrl(value)}
          placeholder="http://192.168.1.10:8000"
          style={inputStyle}
        />
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
          <GButton label={t("welcome.next")} onClick={handleUrlNext} primary />
          <GButton label={t("welcome.autoSearch")} onClick={rescan} />
        </div>
      </Shell>
    );
  }

  if (step === "name") {
    return (
      <Shell title={t("welcome.deviceNameTitle")} subtitle={t("welcome.deviceNamePrompt")}>
        {scanIp !== null && serverUrl.startsWith("http") && (
          <p style={{ marginTop: "-0.8rem", marginBottom: "1.1rem", color: theme.muted, fontSize: "0.82rem" }}>
            {t("welcome.serverLabel", { url: serverUrl })}
          </p>
        )}
        <Input value={deviceName} onChange={({ value }) => setDeviceName(value)} style={inputStyle} />
        <GButton label={t("welcome.startPairing")} onClick={() => void handleStartPairing()} primary />
      </Shell>
    );
  }

  if (step === "pairing" && pairInfo) {
    return (
      <Shell title={t("welcome.pairingTitle")} subtitle={t("welcome.pairingSubtitle")}>
        <div
          style={{
            display: "inline-block",
            maxWidth: "100%",
            fontSize: "3.4rem",
            letterSpacing: "0.18em",
            fontWeight: 800,
            lineHeight: 1.4,
            // left+right padding balance the trailing letter-spacing so it stays inside the card
            padding: "0.12em 0.25em",
            margin: "1.3rem 0 1.7rem",
            whiteSpace: "nowrap",
            ...gradientText,
          }}
        >
          {pairInfo.code}
        </div>
        <Spinner component="div" />
        <p style={{ marginTop: "1.4rem", color: theme.muted }}>{t("welcome.waitingApproval")}</p>
      </Shell>
    );
  }

  // step === "error"
  return (
    <Shell title={t("welcome.errorTitle")}>
      <p style={{ marginBottom: "1.6rem", color: "#f87171" }}>{errorMsg}</p>
      <GButton label={t("common.back")} onClick={() => setStep("url")} primary />
    </Shell>
  );
}
