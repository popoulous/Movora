// Types shared with the web frontend (keep in sync with frontend/src/api.ts).

export type LibraryKind = "anime" | "movie" | "series";
export type WatchStatus = "not_started" | "watching" | "completed";
export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface Library {
  id: number;
  path: string;
  name: string;
  kind: LibraryKind;
  series_count: number;
}

export interface Episode {
  id: number;
  number: number;
  end_number: number | null;
  title: string | null;
  watched: boolean;
  normalized: boolean;
  normalizing: boolean;
  thumbnail_url: string | null;
}

export interface Season {
  id: number;
  number: number;
  episodes: Episode[];
}

export interface SeriesDetail {
  id: number;
  title: string;
  display_title: string | null;
  native_title: string | null;
  year: number | null;
  score: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  description: string | null;
  genres: string | null;
  seasons: Season[];
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
  format: "ass" | "vtt";
  url: string;
}

export interface PlaybackInfo {
  media_file_id: number;
  stream_url: string;
  media_type: string;
  direct_play: boolean;
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

// v2a pairing types (backend endpoints not yet implemented).
export interface PairStart {
  code: string;
  expires_at: string;
}

export type PairStatus = "waiting" | "approved" | "expired";

export interface PairApproved {
  device_id: number;
  device_token: string;
}

// ---------------------------------------------------------------------------

export function createApiClient(baseUrl: string, token: string | null) {
  const base = baseUrl.replace(/\/$/, "");

  const authHeaders = (): HeadersInit =>
    token ? { Authorization: `Bearer ${token}` } : {};

  const jsonHeaders = (): HeadersInit => ({
    "Content-Type": "application/json",
    ...authHeaders(),
  });

  async function checkOk(res: Response): Promise<void> {
    if (res.status === 401) {
      window.dispatchEvent(new Event("movora:unauthorized"));
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  }

  async function asJson<T>(res: Response): Promise<T> {
    await checkOk(res);
    return res.json() as Promise<T>;
  }

  return {
    getHome: () =>
      fetch(`${base}/api/home`, { headers: authHeaders() }).then(asJson<HomeData>),

    getSeries: (id: number) =>
      fetch(`${base}/api/series/${id}`, { headers: authHeaders() }).then(asJson<SeriesDetail>),

    getPlayback: (episodeId: number) =>
      fetch(`${base}/api/episodes/${episodeId}/playback`, { headers: authHeaders() }).then(
        asJson<PlaybackInfo>,
      ),

    recordWatch: (episodeId: number, body: { position_seconds?: number; watched?: boolean }) =>
      fetch(`${base}/api/episodes/${episodeId}/watch-state`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      }).then(checkOk),

    // v2a pairing endpoints — return 404 until backend implements them.
    pairStart: (deviceName: string) =>
      fetch(`${base}/api/devices/pair/start`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ device_name: deviceName }),
      }).then(asJson<PairStart>),

    pairStatus: (code: string) =>
      fetch(`${base}/api/devices/pair/${code}/status`, { headers: authHeaders() }).then(
        asJson<{ status: PairStatus; device_token?: string }>
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
