import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createApiClient, type ApiClient } from "../api/client";

const STORAGE_KEY = "movora_device";

export interface DeviceConfig {
  serverUrl: string;
  deviceToken: string;
  deviceName: string;
}

interface DeviceContextValue {
  config: DeviceConfig | null;
  api: ApiClient | null;
  save: (cfg: DeviceConfig) => void;
  clear: () => void;
}

const DeviceContext = createContext<DeviceContextValue>({
  config: null,
  api: null,
  save: () => undefined,
  clear: () => undefined,
});

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<DeviceConfig | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as DeviceConfig) : null;
    } catch {
      return null;
    }
  });

  const save = useCallback((cfg: DeviceConfig) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setConfig(cfg);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setConfig(null);
  }, []);

  const api = useMemo(
    () => (config ? createApiClient(config.serverUrl, config.deviceToken) : null),
    [config],
  );

  return (
    <DeviceContext.Provider value={{ config, api, save, clear }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
