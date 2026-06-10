// Device capability detection for the TV. We ask the platform what it can decode
// via the two standard probes — HTMLMediaElement.canPlayType() and (for MSE)
// MediaSource.isTypeSupported() — using the same codec strings as the Movora demo
// capability samples (manifest.json). The result drives the backend's
// CompatibilitySelector: the TV reports its real profile instead of being treated
// as a plain browser. canPlayType is advisory ("", "maybe", "probably"); we treat
// anything non-empty, or an MSE yes, as supported, and an HTTP playback probe can
// confirm the uncertain ones later.

export interface CapCheck {
  id: string;
  label: string;
  mime: string;
  canPlay: string; // "", "maybe", "probably"
  mse: boolean;
  supported: boolean;
}

export interface CapReport {
  video: CapCheck[];
  audio: CapCheck[];
  container: CapCheck[];
  // Normalized profile for the backend (parse_capabilities reads these keys).
  video_codecs: string[];
  audio_codecs: string[];
  containers: string[];
  supports_ass: boolean; // native <track> can't render ASS — we serve VTT instead
  supports_srt: boolean;
}

const VIDEO: { id: string; base: string; label: string; mime: string }[] = [
  { id: "h264", base: "h264", label: "H.264 / AVC (High L4.1)", mime: 'video/mp4; codecs="avc1.640029"' },
  { id: "h264b", base: "h264", label: "H.264 / AVC (Baseline)", mime: 'video/mp4; codecs="avc1.42E01F"' },
  { id: "hevc8", base: "hevc", label: "HEVC / H.265 (8-bit)", mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  { id: "hevc10", base: "hevc", label: "HEVC / H.265 (10-bit, Main10)", mime: 'video/mp4; codecs="hvc1.2.4.L93.B0"' },
  { id: "av1", base: "av1", label: "AV1 (8-bit)", mime: 'video/mp4; codecs="av01.0.05M.08"' },
  { id: "vp9", base: "vp9", label: "VP9", mime: 'video/webm; codecs="vp9"' },
];

const AUDIO: { id: string; base: string; label: string; mime: string }[] = [
  { id: "aac", base: "aac", label: "AAC-LC", mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { id: "ac3", base: "ac3", label: "Dolby Digital (AC-3)", mime: 'audio/mp4; codecs="ac-3"' },
  { id: "eac3", base: "eac3", label: "Dolby Digital+ (E-AC-3)", mime: 'audio/mp4; codecs="ec-3"' },
  { id: "opus", base: "opus", label: "Opus", mime: 'audio/webm; codecs="opus"' },
  { id: "flac", base: "flac", label: "FLAC", mime: 'audio/mp4; codecs="flac"' },
];

const CONTAINER: { id: string; label: string; mime: string }[] = [
  { id: "mp4", label: "MP4", mime: "video/mp4" },
  { id: "mkv", label: "Matroska (MKV)", mime: "video/x-matroska" },
  { id: "webm", label: "WebM", mime: "video/webm" },
];

function check(id: string, label: string, mime: string): CapCheck {
  let canPlay = "";
  try {
    canPlay = document.createElement("video").canPlayType(mime);
  } catch {
    canPlay = "";
  }
  let mse = false;
  try {
    mse =
      typeof MediaSource !== "undefined" &&
      typeof MediaSource.isTypeSupported === "function" &&
      MediaSource.isTypeSupported(mime);
  } catch {
    mse = false;
  }
  return { id, label, mime, canPlay, mse, supported: canPlay !== "" || mse };
}

function distinctBases(checks: CapCheck[], defs: { id: string; base: string }[]): string[] {
  const bases = new Set<string>();
  for (const c of checks) {
    if (!c.supported) continue;
    const def = defs.find((d) => d.id === c.id);
    if (def) bases.add(def.base);
  }
  return [...bases];
}

// --- Real HTTP playback probe (ground truth; canPlayType is only advisory) ------

export interface ServerSample {
  id: string;
  category: string; // video | container | audio | subtitle
  label: string;
  mime: string;
  filename: string;
}

export interface ProbeResult {
  played: boolean; // the element reached a playable state without erroring
  videoBytes: number; // decoded video bytes (0 if the platform doesn't expose the counter)
  audioBytes: number; // decoded audio bytes (lets us tell an unsupported audio codec apart)
  hasAudio: boolean | null; // audio probe: a real signal was heard (null if not measured)
  audioRms: number | null; // measured audio RMS (0..~128); diagnostic for the signal test
  cues: number | null; // subtitle probe: parsed cue count (null if N/A)
}

export async function fetchSamples(base: string): Promise<ServerSample[]> {
  const root = base.replace(/\/$/, "");
  const res = await fetch(`${root}/api/capabilities/samples`);
  if (!res.ok) return [];
  return (await res.json()) as ServerSample[];
}

export function sampleUrl(base: string, id: string): string {
  return `${base.replace(/\/$/, "")}/api/capabilities/samples/${id}`;
}

// Actually load + play the clip and report whether it decodes. We wait briefly
// after playback starts so the (non-standard but Chrome-87-present) decoded-byte
// counters can populate — that's what tells "video plays but audio codec failed"
// apart from a clean success.
export function probePlayback(url: string, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const v = document.createElement("video") as HTMLVideoElement & {
      webkitVideoDecodedByteCount?: number;
      webkitAudioDecodedByteCount?: number;
    };
    v.muted = true;
    v.preload = "auto";
    let done = false;
    let timer = 0;
    let settle = 0;
    const result = (played: boolean): ProbeResult => ({
      played,
      videoBytes: v.webkitVideoDecodedByteCount ?? 0,
      audioBytes: v.webkitAudioDecodedByteCount ?? 0,
      hasAudio: null,
      audioRms: null,
      cues: null,
    });
    const finish = (played: boolean): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      const r = result(played);
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const onPlayable = (): void => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => finish(true), 700);
    };
    v.addEventListener("loadeddata", onPlayable);
    v.addEventListener("playing", onPlayable);
    v.addEventListener("error", () => finish(false));
    v.src = url;
    const p = v.play();
    if (p !== undefined && typeof p.catch === "function") p.catch(() => undefined);
    timer = window.setTimeout(() => finish(v.readyState >= 2), timeoutMs);
  });
}

// A single AudioContext, resumed on user input. TV browsers gate AudioContext
// behind a user gesture (autoplay policy); without a running context the analyser
// only ever sees silence — which looked like "no audio everywhere". Call
// resumeAudioContext() from a keydown handler so it is running before we measure.
let sharedAudioCtx: AudioContext | null = null;
function audioCtor(): typeof AudioContext | undefined {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}
export function resumeAudioContext(): AudioContext | null {
  const Ctor = audioCtor();
  if (Ctor === undefined) return null;
  if (sharedAudioCtx === null) {
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      sharedAudioCtx = null;
      return null;
    }
  }
  void sharedAudioCtx.resume();
  return sharedAudioCtx;
}

// Audio probe: route the element through the shared Web Audio context and measure
// the real signal (RMS). This catches "video plays but there's no sound" — an
// unsupported audio codec the player silently drops. Output is kept silent (gain 0).
export function probeAudio(url: string, timeoutMs = 7000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const ctx = resumeAudioContext();
    const v = document.createElement("video") as HTMLVideoElement & {
      webkitVideoDecodedByteCount?: number;
      webkitAudioDecodedByteCount?: number;
    };
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.volume = 0.6; // audible (also our by-ear fallback) but not blasting
    // Some webOS builds only feed Web Audio when the element is in the document.
    v.style.position = "fixed";
    v.style.left = "-9999px";
    v.style.width = "1px";
    v.style.height = "1px";
    document.body.appendChild(v);
    let analyser: AnalyserNode | null = null;
    let srcNode: AudioNode | null = null;
    let maxRms = 0;
    let done = false;
    let timer = 0;
    let tick = 0;
    const finish = (played: boolean, hasAudio: boolean | null, rms: number | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.clearTimeout(tick);
      try {
        srcNode?.disconnect();
      } catch {
        /* ignore */
      }
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        /* ignore */
      }
      try {
        if (v.parentNode !== null) v.parentNode.removeChild(v);
      } catch {
        /* ignore */
      }
      resolve({
        played,
        videoBytes: v.webkitVideoDecodedByteCount ?? 0,
        audioBytes: v.webkitAudioDecodedByteCount ?? 0,
        hasAudio,
        audioRms: rms,
        cues: null,
      });
    };
    const measure = (): void => {
      if (analyser === null) return;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const c = buf[i] - 128;
        sum += c * c;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > maxRms) maxRms = rms;
    };
    const onPlaying = (): void => {
      if (analyser !== null) return;
      if (ctx === null) {
        tick = window.setTimeout(() => finish(true, null, null), 800);
        return;
      }
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        // Prefer captureStream(): it taps the element's actual rendered output, so
        // it works where createMediaElementSource is a no-op (webOS). The element
        // keeps playing audibly on its own, which is also our by-ear fallback.
        const cap = v as HTMLVideoElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
        const capture = cap.captureStream ?? cap.mozCaptureStream;
        const stream = typeof capture === "function" ? capture.call(v) : null;
        if (stream !== null && stream.getAudioTracks().length > 0) {
          srcNode = ctx.createMediaStreamSource(stream);
          srcNode.connect(analyser); // MediaStreamSource pushes; no destination needed
        } else {
          // Fallback: route through Web Audio (low gain so it stays audible too).
          const node = ctx.createMediaElementSource(v);
          srcNode = node;
          const gain = ctx.createGain();
          gain.gain.value = 0.3;
          node.connect(analyser);
          analyser.connect(gain);
          gain.connect(ctx.destination);
        }
        void ctx.resume();
      } catch {
        finish(true, null, null);
        return;
      }
      let n = 0;
      const loop = (): void => {
        measure();
        n += 1;
        if (n >= 7) finish(true, maxRms > 2, maxRms);
        else tick = window.setTimeout(loop, 90);
      };
      tick = window.setTimeout(loop, 120);
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", () => finish(false, null, null));
    v.src = url;
    const p = v.play();
    if (p !== undefined && typeof p.catch === "function") p.catch(() => undefined);
    timer = window.setTimeout(
      () => finish(v.readyState >= 2, analyser !== null ? maxRms > 2 : null, analyser !== null ? maxRms : null),
      timeoutMs,
    );
  });
}

// Subtitle probe: attach the file as a <track> and see whether the platform parses
// cues. Only WebVTT renders natively; SRT/ASS yield no cues -> they need conversion.
export function probeSubtitle(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.style.position = "absolute";
    v.style.width = "1px";
    v.style.height = "1px";
    v.style.opacity = "0";
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.srclang = "en";
    track.default = true;
    track.src = url;
    v.appendChild(track);
    document.body.appendChild(v);
    let done = false;
    let timer = 0;
    const cueCount = (): number => {
      try {
        const cues = track.track.cues;
        return cues !== null ? cues.length : 0;
      } catch {
        return 0;
      }
    };
    const finish = (cues: number): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        document.body.removeChild(v);
      } catch {
        /* ignore */
      }
      resolve({ played: cues > 0, videoBytes: 0, audioBytes: 0, hasAudio: null, audioRms: null, cues });
    };
    track.addEventListener("load", () => finish(cueCount()));
    track.addEventListener("error", () => finish(0));
    try {
      track.track.mode = "hidden"; // activate so the UA fetches + parses cues
    } catch {
      /* ignore */
    }
    timer = window.setTimeout(() => finish(cueCount()), timeoutMs);
  });
}

export function detectCapabilities(): CapReport {
  const video = VIDEO.map((x) => check(x.id, x.label, x.mime));
  const audio = AUDIO.map((x) => check(x.id, x.label, x.mime));
  const container = CONTAINER.map((x) => check(x.id, x.label, x.mime));
  return {
    video,
    audio,
    container,
    video_codecs: distinctBases(video, VIDEO),
    audio_codecs: distinctBases(audio, AUDIO),
    containers: container.filter((c) => c.supported).map((c) => c.id),
    supports_ass: false,
    supports_srt: true,
  };
}
