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

type Step = "url" | "name" | "pairing" | "error";

interface Props {
  onDone: () => void;
}

export default function WelcomeView({ onDone }: Props): React.JSX.Element {
  const { save } = useDevice();

  const [step, setStep] = useState<Step>("url");
  const [serverUrl, setServerUrl] = useState("http://");
  const [deviceName, setDeviceName] = useState("Living Room TV");
  const [pairInfo, setPairInfo] = useState<PairStart | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    },
    [],
  );

  function handleUrlNext() {
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url.startsWith("http")) {
      setErrorMsg("A szerver URL http:// vagy https:// -sel kell kezdődjön.");
      setStep("error");
      return;
    }
    setServerUrl(url);
    setStep("name");
  }

  async function handleStartPairing() {
    const client = createApiClient(serverUrl, null);
    try {
      const info = await client.pairStart(deviceName);
      setPairInfo(info);
      setStep("pairing");
      startPolling(info.code);
    } catch {
      setErrorMsg(
        "Nem sikerült párosítást indítani. Ellenőrizd a szerver URL-t, " +
          "és győzödj meg róla, hogy a szerver v2a vagy újabb verziót futtat.",
      );
      setStep("error");
    }
  }

  function startPolling(code: string) {
    const client = createApiClient(serverUrl, null);
    pollRef.current = setInterval(() => {
      void client.pairStatus(code).then((res) => {
        if (res.status === "approved" && res.device_token) {
          clearInterval(pollRef.current!);
          save({ serverUrl, deviceToken: res.device_token, deviceName });
          onDone();
        } else if (res.status === "expired") {
          clearInterval(pollRef.current!);
          setErrorMsg("A párosítási kód lejárt. Próbáld újra.");
          setStep("error");
        }
      }).catch(() => {
        // Ignore transient fetch errors while polling.
      });
    }, 3000);
  }

  if (step === "url") {
    return (
      <Panel>
        <Header title="Movora" subtitle="Add meg a szerver URL-t" />
        <div style={{ padding: "2rem", maxWidth: 600 }}>
          <Input
            value={serverUrl}
            onChange={({ value }) => setServerUrl(value)}
            placeholder="http://192.168.1.10:8000"
            style={{ marginBottom: "1.5rem", width: "100%" }}
          />
          <Button onClick={handleUrlNext}>Tovább</Button>
        </div>
      </Panel>
    );
  }

  if (step === "name") {
    return (
      <Panel>
        <Header title="Eszköz neve" subtitle="Milyen névvel jelenjen meg a párosítás oldalon?" />
        <div style={{ padding: "2rem", maxWidth: 600 }}>
          <Input
            value={deviceName}
            onChange={({ value }) => setDeviceName(value)}
            style={{ marginBottom: "1.5rem", width: "100%" }}
          />
          <Button onClick={() => void handleStartPairing()}>Párosítás indítása</Button>
        </div>
      </Panel>
    );
  }

  if (step === "pairing" && pairInfo) {
    return (
      <Panel>
        <Header title="Párosítás" subtitle="Nyisd meg a Movora webes felületet, és fogadd el a párosítást." />
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
          <p style={{ marginTop: "1.5rem", opacity: 0.7 }}>
            Várakozás a jóváhagyásra…
          </p>
        </div>
      </Panel>
    );
  }

  // step === "error"
  return (
    <Panel>
      <Header title="Hiba" />
      <div style={{ padding: "2rem", maxWidth: 600 }}>
        <p style={{ marginBottom: "1.5rem", color: "#f87171" }}>{errorMsg}</p>
        <Button onClick={() => setStep("url")}>Vissza</Button>
      </div>
    </Panel>
  );
}
