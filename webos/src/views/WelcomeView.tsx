import React, { useEffect, useRef, useState } from "react";
import { Panel, Header } from "@enact/sandstone/Panels";
import Button from "@enact/sandstone/Button";
import InputBase from "@enact/sandstone/Input";
import Spinner from "@enact/sandstone/Spinner";

// Enact Input's actual onChange passes {value}, not a DOM event — override the type.
const Input = InputBase as unknown as React.ComponentType<{
  value: string;
  onChange: (e: { value: string }) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}>;
import { createApiClient, type PairStart } from "../api/client";
import { useDevice } from "../context/DeviceContext";
import { useI18n } from "../i18n";
import { discoverServer } from "../discovery";

type Step = "discover" | "url" | "name" | "pairing" | "error";

interface Props {
  onDone: () => void;
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

  if (step === "discover" && scanning) {
    return (
      <Panel>
        <Header title="Movora" subtitle={t("welcome.searching")} />
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <Spinner component="div" />
          <p style={{ marginTop: "1.5rem", opacity: 0.7 }}>
            {scanIp !== null
              ? t("welcome.tvAddress", { ip: scanIp, percent: scanPct })
              : t("welcome.determiningAddress")}
          </p>
        </div>
      </Panel>
    );
  }

  if (step === "discover") {
    // Sweep finished without a hit.
    const subnet = scanIp !== null ? scanIp.replace(/\.\d+$/, "") : null;
    return (
      <Panel>
        <Header title={t("welcome.noServerTitle")} />
        <div style={{ padding: "2rem", maxWidth: 600 }}>
          <p style={{ marginBottom: "1.5rem", opacity: 0.8 }}>
            {scanIp === null
              ? t("welcome.noIpBody")
              : t("welcome.noServerBody", { subnet: subnet ?? "" })}
          </p>
          <div style={{ display: "flex", gap: "1rem" }}>
            <Button onClick={rescan}>{t("welcome.rescan")}</Button>
            <Button onClick={() => setStep("url")}>{t("welcome.manualEntry")}</Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (step === "url") {
    return (
      <Panel>
        <Header title="Movora" subtitle={t("welcome.enterUrl")} />
        <div style={{ padding: "2rem", maxWidth: 600 }}>
          <Input
            value={serverUrl}
            onChange={({ value }) => setServerUrl(value)}
            placeholder="http://192.168.1.10:8000"
            style={{ marginBottom: "1.5rem", width: "100%" }}
          />
          <div style={{ display: "flex", gap: "1rem" }}>
            <Button onClick={handleUrlNext}>{t("welcome.next")}</Button>
            <Button onClick={rescan}>{t("welcome.autoSearch")}</Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (step === "name") {
    return (
      <Panel>
        <Header title={t("welcome.deviceNameTitle")} subtitle={t("welcome.deviceNamePrompt")} />
        <div style={{ padding: "2rem", maxWidth: 600 }}>
          {scanIp !== null && serverUrl.startsWith("http") && (
            <p style={{ marginBottom: "1rem", opacity: 0.6, fontSize: "0.85rem" }}>
              {t("welcome.serverLabel", { url: serverUrl })}
            </p>
          )}
          <Input
            value={deviceName}
            onChange={({ value }) => setDeviceName(value)}
            style={{ marginBottom: "1.5rem", width: "100%" }}
          />
          <Button onClick={() => void handleStartPairing()}>{t("welcome.startPairing")}</Button>
        </div>
      </Panel>
    );
  }

  if (step === "pairing" && pairInfo) {
    return (
      <Panel>
        <Header title={t("welcome.pairingTitle")} subtitle={t("welcome.pairingSubtitle")} />
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <div
            style={{
              fontSize: "4rem",
              letterSpacing: "0.4em",
              fontWeight: 700,
              color: "#c084fc",
              margin: "2rem 0",
            }}
          >
            {pairInfo.code}
          </div>
          <Spinner component="div" />
          <p style={{ marginTop: "1.5rem", opacity: 0.7 }}>{t("welcome.waitingApproval")}</p>
        </div>
      </Panel>
    );
  }

  // step === "error"
  return (
    <Panel>
      <Header title={t("welcome.errorTitle")} />
      <div style={{ padding: "2rem", maxWidth: 600 }}>
        <p style={{ marginBottom: "1.5rem", color: "#f87171" }}>{errorMsg}</p>
        <Button onClick={() => setStep("url")}>{t("common.back")}</Button>
      </div>
    </Panel>
  );
}
