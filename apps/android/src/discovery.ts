// Auto-discover the Movora server on the LAN — ported from apps/webos. Every server
// exposes an unauthenticated GET /health returning {"app":"Movora",...} with open CORS,
// so we read this device's IP (via NetInfo) and sweep the /24 for that marker on :8000.

import NetInfo from '@react-native-community/netinfo';

const SERVER_PORT = 8000;
const HEALTH_TIMEOUT_MS = 900;
const CONCURRENCY = 24;

export interface ScanProgress {
  checked: number;
  total: number;
}

export async function getLocalIp(): Promise<string | null> {
  try {
    const state = await NetInfo.fetch();
    const ip = (state.details as {ipAddress?: string} | null)?.ipAddress;
    return typeof ip === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

async function probe(ip: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${ip}:${SERVER_PORT}/health`, {signal: controller.signal});
    if (!res.ok) {
      return false;
    }
    const data = (await res.json()) as {app?: string};
    return data.app === 'Movora';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function scanForServer(
  baseIp: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<string | null> {
  const base = baseIp.replace(/\.\d+$/, '.');
  const hosts = Array.from({length: 254}, (_, i) => i + 1);
  const total = hosts.length;
  let checked = 0;
  let found: string | null = null;
  let cursor = 0;

  // Bounded worker pool; the first host that answers ends the sweep early.
  async function worker(): Promise<void> {
    while (found === null && cursor < hosts.length) {
      const ip = `${base}${hosts[cursor++]}`;
      const ok = await probe(ip);
      checked += 1;
      onProgress?.({checked, total});
      if (ok) {
        found = `http://${ip}:${SERVER_PORT}`;
        return;
      }
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));
  return found;
}

export interface DiscoveryResult {
  ip: string | null; // this device's own IP (null if it couldn't be determined)
  serverUrl: string | null; // discovered Movora base URL (null if none found)
}

export async function discoverServer(
  onProgress?: (p: ScanProgress) => void,
): Promise<DiscoveryResult> {
  const ip = await getLocalIp();
  if (ip === null) {
    return {ip: null, serverUrl: null};
  }
  return {ip, serverUrl: await scanForServer(ip, onProgress)};
}
