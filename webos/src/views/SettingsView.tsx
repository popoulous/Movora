import React, { useState } from "react";
import { Panel, Header } from "@enact/sandstone/Panels";
import Button from "@enact/sandstone/Button";
import { useDevice } from "../context/DeviceContext";
import { discoverServer } from "../discovery";

interface Props {
  onBack: () => void;
  onCapability: () => void;
}

export default function SettingsView({ onBack, onCapability }: Props): React.JSX.Element {
  const { config, save, clear } = useDevice();
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);

  function handleUnpair(): void {
    clear();
    onBack();
  }

  function handleRescan(): void {
    setRescanning(true);
    setRescanMsg(null);
    void discoverServer().then((res) => {
      setRescanning(false);
      if (res.serverUrl !== null && config !== null) {
        save({ ...config, serverUrl: res.serverUrl });
        setRescanMsg(`Szerver frissítve: ${res.serverUrl}`);
      } else if (res.ip === null) {
        setRescanMsg("Nem sikerült megállapítani a TV hálózati címét.");
      } else {
        setRescanMsg("Nem találtam Movora szervert a hálózaton.");
      }
    });
  }

  return (
    <Panel>
      <Header
        title="Beállítások"
        slotBefore={
          <Button size="small" onClick={onBack}>
            ←
          </Button>
        }
      />
      <div style={{ padding: "2rem", maxWidth: 600 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "2rem" }}>
          <tbody>
            <tr>
              <td style={{ padding: "0.5rem 0", opacity: 0.6, width: 160 }}>Szerver URL</td>
              <td style={{ padding: "0.5rem 0", fontWeight: 600, color: "#c084fc" }}>
                {config?.serverUrl ?? "–"}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.5rem 0", opacity: 0.6 }}>Eszköz neve</td>
              <td style={{ padding: "0.5rem 0" }}>{config?.deviceName ?? "–"}</td>
            </tr>
            <tr>
              <td style={{ padding: "0.5rem 0", opacity: 0.6 }}>Token</td>
              <td style={{ padding: "0.5rem 0", fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.5 }}>
                {config?.deviceToken
                  ? `${config.deviceToken.slice(0, 12)}…`
                  : "–"}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={handleRescan} disabled={rescanning}>
            {rescanning ? "Keresés…" : "Szerver újrakeresése"}
          </Button>
          <Button onClick={onCapability}>Képességteszt</Button>
          <Button onClick={handleUnpair}>Szétválasztás (unpair)</Button>
        </div>
        {rescanMsg !== null && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#c084fc" }}>{rescanMsg}</p>
        )}
        <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", opacity: 0.5 }}>
          Az újrakeresés a hálózaton keresi a szervert és frissíti a címet (a párosítás megmarad).
          Szétválasztás után az app visszatér a beállítási képernyőre.
        </p>

        <div
          style={{
            marginTop: "3rem",
            padding: "1rem",
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            fontSize: "0.8rem",
            opacity: 0.6,
          }}
        >
          Movora webOS kliens · v0.1.0
        </div>
      </div>
    </Panel>
  );
}
