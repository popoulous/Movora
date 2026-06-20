// Movora REST client — ported from apps/webos/src/api/client.ts. The types are shared
// with the web frontend (keep in sync with frontend/src/api.ts); fetch works in React
// Native, so the only change from the webOS client is the unauthorized hook (no `window`).

import {getActiveLang} from '../i18n';

// The UI language, appended to read requests so the server localizes metadata.
const langParam = (): string => `?lang=${getActiveLang()}`;

export type LibraryKind = 'anime' | 'movie' | 'series';
export type WatchStatus = 'not_started' | 'watching' | 'completed';

export interface Library {
  id: number;
  path: string;
  name: string;
  kind: LibraryKind;
  series_count: number;
}

export interface SeriesSummary {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  cover_image_url: string | null;
  episode_count: number;
  watch_status: WatchStatus;
  watch_percent: number;
  normalized: boolean;
  continue_episode_id: number | null;
}

export interface Episode {
  id: number;
  number: number;
  end_number: number | null;
  title: string | null;
  watched: boolean;
  normalized: boolean;
  normalizing: boolean;
  device_ready: boolean | null;
  thumbnail_url: string | null;
}

export interface Season {
  id: number;
  number: number;
  episodes: Episode[];
}

export interface Recommendation {
  title: string;
  cover_image_url: string | null;
  score: number | null;
  target_series_id: number | null;
}

export interface SeriesDetail {
  id: number;
  title: string;
  display_title: string | null;
  native_title: string | null;
  year: number | null;
  end_year: number | null;
  format: string | null;
  episode_duration: number | null;
  score: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  description: string | null;
  genres: string | null;
  seasons: Season[];
  recommendations: Recommendation[];
  watch: {
    status: WatchStatus;
    episodes_watched: number;
    total: number;
    percent: number;
    continue_episode_id: number | null;
  } | null;
}

export interface HomeSeries {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  watch_status: WatchStatus;
  continue_episode_id: number | null;
  continue_episode_number: number | null;
  continue_season_number: number | null;
  continue_percent: number;
  continue_thumbnail_url: string | null;
}

export interface HomeData {
  hero: HomeSeries | null;
  continue_watching: HomeSeries[];
  recently_added: HomeSeries[];
  recently_finished: HomeSeries[];
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string | null;
  format: 'ass' | 'vtt';
  url: string;
}

export interface PlaybackInfo {
  media_file_id: number;
  stream_url: string;
  media_type: string;
  direct_play: boolean;
  variant_status: 'direct' | 'preparing' | 'ready' | 'unavailable';
  prepare_progress: number;
  prepare_eta_seconds: number | null;
  subtitle_tracks: SubtitleTrack[];
  resume_position: number;
  intro_start: number | null;
  intro_end: number | null;
  outro_start: number | null;
  outro_end: number | null;
  series_id: number;
  series_title: string;
  season_number: number;
  episode_number: number;
  episode_end_number: number | null;
  episode_title: string | null;
  banner_image_url: string | null;
  cover_image_url: string | null;
}

export interface PairStart {
  code: string;
  expires_at: string;
}

export type PairStatus = 'waiting' | 'approved' | 'expired';

// Capability probe — the device plays each sample clip and reports what decoded, so the
// backend's CompatibilitySelector knows the device's real profile (see apps/webos).
export interface ServerSample {
  id: string;
  category: string; // "video" | "container" | "audio" | "subtitle"
  label: string;
  mime: string;
  filename: string;
}

export interface CapabilityProbeOutcome {
  played: boolean;
  video_bytes: number;
  audio_bytes: number;
  has_audio: boolean | null;
  audio_rms: number | null;
  cues: number | null;
}

export interface CapabilityReportBody {
  probe: Record<string, CapabilityProbeOutcome>;
  supports_ass: boolean;
  supports_srt: boolean;
  supports_vtt: boolean;
  user_agent: string;
}

// A 401 anywhere means the device token was revoked; the app listens to unpair + return
// to the welcome screen (the webOS client used a window event, RN uses this hook).
let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// Resolve an image/media URL. Internal (relative) URLs get the server base + the device
// token as a ?token= query param (the player/Image can't send an Authorization header);
// absolute URLs (AniList/TMDB posters) pass through untouched.
export function mediaUrl(
  base: string,
  token: string | null,
  url: string | null | undefined,
): string | undefined {
  if (!url) {
    return undefined;
  }
  if (!url.startsWith('/')) {
    return url;
  }
  const root = base.replace(/\/$/, '');
  if (!token) {
    return `${root}${url}`;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${root}${url}${sep}token=${encodeURIComponent(token)}`;
}

// A capability sample clip URL (the endpoint is public — no token needed).
export function sampleUrl(base: string, id: string): string {
  return `${base.replace(/\/$/, '')}/api/capabilities/samples/${encodeURIComponent(id)}`;
}

export function createApiClient(baseUrl: string, token: string | null) {
  const base = baseUrl.replace(/\/$/, '');

  const authHeaders = (): Record<string, string> =>
    token ? {Authorization: `Bearer ${token}`} : {};

  const jsonHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...authHeaders(),
  });

  async function checkOk(res: Response): Promise<void> {
    if (res.status === 401) {
      onUnauthorized();
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }

  async function asJson<T>(res: Response): Promise<T> {
    await checkOk(res);
    return (await res.json()) as T;
  }

  return {
    getHome: () =>
      fetch(`${base}/api/home${langParam()}`, {headers: authHeaders()}).then(asJson<HomeData>),

    getLibraries: () =>
      fetch(`${base}/api/libraries`, {headers: authHeaders()}).then(asJson<Library[]>),

    listSeries: (libraryId: number) =>
      fetch(`${base}/api/libraries/${libraryId}/series${langParam()}`, {
        headers: authHeaders(),
      }).then(asJson<SeriesSummary[]>),

    getSeries: (id: number) =>
      fetch(`${base}/api/series/${id}${langParam()}`, {headers: authHeaders()}).then(
        asJson<SeriesDetail>,
      ),

    getPlayback: (episodeId: number) =>
      fetch(`${base}/api/episodes/${episodeId}/playback${langParam()}`, {
        headers: authHeaders(),
      }).then(asJson<PlaybackInfo>),

    recordWatch: (
      episodeId: number,
      body: {position_seconds?: number; watched?: boolean},
    ) =>
      fetch(`${base}/api/episodes/${episodeId}/watch-state`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }).then(checkOk),

    pairStart: (deviceName: string) =>
      fetch(`${base}/api/devices/pair/start`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({device_name: deviceName}),
      }).then(asJson<PairStart>),

    pairStatus: (code: string) =>
      fetch(`${base}/api/devices/pair/${code}/status`, {headers: authHeaders()}).then(
        asJson<{status: PairStatus; device_token?: string}>,
      ),

    getCapabilitySamples: () =>
      fetch(`${base}/api/capabilities/samples`).then(asJson<ServerSample[]>),

    reportCapabilities: (body: CapabilityReportBody) =>
      fetch(`${base}/api/devices/me/capabilities`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }).then(checkOk),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// A token-less client just for the pairing handshake (before we have a device token).
export function createPairingClient(baseUrl: string): ApiClient {
  return createApiClient(baseUrl, null);
}
