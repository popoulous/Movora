// Automatic Movora server discovery on the local network.
//
// No backend support is needed: every Movora server exposes an unauthenticated
// GET /health that returns {"status":"ok","app":"Movora",...} with open CORS, so
// we sweep the TV's /24 subnet and match that marker. The backend always listens
// on :8000 (dev script + Docker), which is the stable target — unlike the Vite
// dev server, whose port changes.

const SERVER_PORT = 8000;
const HEALTH_TIMEOUT_MS = 700;
const CONCURRENCY = 24;
const LOCAL_IP_TIMEOUT_MS = 1500;

export interface ScanProgress {
  checked: number;
  total: number;
}

// --- TV local IP -----------------------------------------------------------

// webOS exposes Luna services through a native PalmServiceBridge global in the
// app webview (no webOSTV.js needed). connectionmanager/getStatus reports the
// active interface's IPv4, which gives us the subnet to sweep.
interface PalmBridge {
  onservicecallback: ((msg: string) => void) | null;
  call(uri: string, params: string): void;
}
type PalmCtor = new () => PalmBridge;

function palmGetStatus(): Promise<unknown> {
  const Ctor = (window as unknown as { PalmServiceBridge?: PalmCtor }).PalmServiceBridge;
  if (typeof Ctor !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const bridge = new Ctor();
      bridge.onservicecallback = (msg: string): void => {
        try {
          finish(JSON.parse(msg));
        } catch {
          finish(null);
        }
      };
      bridge.call("luna://com.webos.service.connectionmanager/getStatus", "{}");
      setTimeout(() => finish(null), LOCAL_IP_TIMEOUT_MS);
    } catch {
      finish(null);
    }
  });
}

function ipFromStatus(status: unknown): string | null {
  if (typeof status !== "object" || status === null) return null;
  const s = status as Record<string, unknown>;
  for (const key of ["wired", "wifi"] as const) {
    const iface = s[key];
    if (typeof iface === "object" && iface !== null) {
      const ip = (iface as Record<string, unknown>).ipAddress;
      if (typeof ip === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    }
  }
  return null;
}

// Fallback: harvest the private IP from a WebRTC ICE candidate. Newer Chromium
// masks it behind an mDNS .local name; when that happens this yields nothing and
// we fall back to manual entry.
function webrtcLocalIp(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let pc: RTCPeerConnection;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch {
      resolve(null);
      return;
    }
    pc.onicecandidate = (e: RTCPeerConnectionIceEvent): void => {
      if (e.candidate === null) return;
      const text = e.candidate.candidate;
      if (text.includes(".local")) return;
      const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(text);
      if (m !== null && !m[1].startsWith("0.")) finish(m[1]);
    };
    pc.createDataChannel("movora");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(null));
    setTimeout(() => finish(null), LOCAL_IP_TIMEOUT_MS);
  });
}

export async function getLocalIp(): Promise<string | null> {
  const status = await palmGetStatus();
  const ip = ipFromStatus(status);
  if (ip !== null) return ip;
  return webrtcLocalIp();
}

// --- Subnet sweep ----------------------------------------------------------

async function probe(ip: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${ip}:${SERVER_PORT}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = (await res.json()) as { app?: string };
    return data.app === "Movora";
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
  const base = baseIp.replace(/\.\d+$/, ".");
  const hosts = Array.from({ length: 254 }, (_, i) => i + 1);
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
      if (onProgress) onProgress({ checked, total });
      if (ok) {
        found = `http://${ip}:${SERVER_PORT}`;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return found;
}

export interface DiscoveryResult {
  ip: string | null; // the TV's own IP (null if it couldn't be determined)
  serverUrl: string | null; // discovered Movora base URL (null if none found)
}

export async function discoverServer(
  onProgress?: (p: ScanProgress) => void,
): Promise<DiscoveryResult> {
  const ip = await getLocalIp();
  if (ip === null) return { ip: null, serverUrl: null };
  const serverUrl = await scanForServer(ip, onProgress);
  return { ip, serverUrl };
}
