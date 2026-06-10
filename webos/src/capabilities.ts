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
