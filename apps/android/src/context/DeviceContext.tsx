import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';

import {createApiClient, setUnauthorizedHandler, type ApiClient} from '../api/client';

const STORAGE_KEY = 'movora_device';

export interface DeviceConfig {
  serverUrl: string;
  deviceToken: string;
  deviceName: string;
}

interface DeviceContextValue {
  config: DeviceConfig | null;
  api: ApiClient | null;
  ready: boolean; // false until the persisted config has been read from storage
  save: (cfg: DeviceConfig) => Promise<void>;
  clear: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue>({
  config: null,
  api: null,
  ready: false,
  save: async () => undefined,
  clear: async () => undefined,
});

export function DeviceProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [ready, setReady] = useState(false);

  // AsyncStorage is async, so unlike the webOS localStorage client we load on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!cancelled && raw) {
          setConfig(JSON.parse(raw) as DeviceConfig);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<DeviceContextValue>(() => {
    const save = async (cfg: DeviceConfig): Promise<void> => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      setConfig(cfg);
    };
    const clear = async (): Promise<void> => {
      await AsyncStorage.removeItem(STORAGE_KEY);
      setConfig(null);
    };
    const api = config ? createApiClient(config.serverUrl, config.deviceToken) : null;
    return {config, api, ready, save, clear};
  }, [config, ready]);

  // A revoked token (401) anywhere clears the pairing and bounces back to Welcome.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void value.clear();
    });
  }, [value]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
