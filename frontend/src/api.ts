export type LibraryKind = "anime" | "movie" | "series";

export interface Library {
  id: number;
  path: string;
  name: string;
  kind: LibraryKind;
}

export interface SeriesSummary {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  score: number | null;
  cover_image_url: string | null;
}

export interface Episode {
  id: number;
  number: number;
  title: string | null;
  watched: boolean;
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

export type WatchStatus = "not_started" | "watching" | "completed";

export interface SeriesWatch {
  status: WatchStatus;
  episodes_watched: number;
  total: number;
  percent: number;
  continue_episode_id: number | null;
  started_at: string | null;
  finished_at: string | null;
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
  watch: SeriesWatch | null;
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
  fonts: string[];
  resume_position: number;
}

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  path: string | null;
  parent: string | null;
  directories: FsEntry[];
}

export interface ServerSettings {
  auto_normalize: boolean;
  auto_normalize_existing: boolean;
  delete_original: boolean;
}

export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface Task {
  id: number;
  type: string; // "scan" | "metadata" | "normalize"
  status: TaskStatus;
  progress: number;
  eta_seconds: number | null;
  message: string | null;
  library_id: number | null;
  library_name: string | null;
  library_kind: string | null;
  series_id: number | null;
  series_title: string | null;
  season_number: number | null;
  episode_id: number | null;
  episode_number: number | null;
  episode_title: string | null;
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function throwIfNotOk(response: Response): void {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
}

export const api = {
  listLibraries: (): Promise<Library[]> => fetch("/api/libraries").then(asJson<Library[]>),
  createLibrary: (body: { path: string; name: string; kind: LibraryKind }): Promise<Library> =>
    fetch("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<Library>),
  scanLibrary: (id: number): Promise<void> =>
    fetch(`/api/libraries/${id}/scan`, { method: "POST" }).then(throwIfNotOk),
  enrichLibrary: (id: number): Promise<void> =>
    fetch(`/api/libraries/${id}/enrich`, { method: "POST" }).then(throwIfNotOk),
  updateLibrary: (id: number, body: { name?: string; kind?: LibraryKind }): Promise<Library> =>
    fetch(`/api/libraries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<Library>),
  deleteLibrary: (id: number): Promise<void> =>
    fetch(`/api/libraries/${id}`, { method: "DELETE" }).then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
    }),
  listSeries: (libraryId: number): Promise<SeriesSummary[]> =>
    fetch(`/api/libraries/${libraryId}/series`).then(asJson<SeriesSummary[]>),
  getSeries: (id: number): Promise<SeriesDetail> =>
    fetch(`/api/series/${id}`).then(asJson<SeriesDetail>),
  getPlayback: (episodeId: number): Promise<PlaybackInfo> =>
    fetch(`/api/episodes/${episodeId}/playback`).then(asJson<PlaybackInfo>),
  recordWatch: (
    episodeId: number,
    body: { position_seconds?: number; watched?: boolean },
  ): Promise<void> =>
    fetch(`/api/episodes/${episodeId}/watch-state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(throwIfNotOk),
  normalizeEpisode: (episodeId: number): Promise<void> =>
    fetch(`/api/episodes/${episodeId}/normalize`, { method: "POST" }).then(throwIfNotOk),
  listTasks: (): Promise<Task[]> => fetch("/api/tasks").then(asJson<Task[]>),
  normalizeAll: (): Promise<void> =>
    fetch("/api/normalize/all", { method: "POST" }).then(throwIfNotOk),
  getSettings: (): Promise<ServerSettings> =>
    fetch("/api/settings").then(asJson<ServerSettings>),
  updateSettings: (body: Partial<ServerSettings>): Promise<ServerSettings> =>
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<ServerSettings>),
  browseFs: (path?: string): Promise<FsListing> => {
    const query = path !== undefined ? `?path=${encodeURIComponent(path)}` : "";
    return fetch(`/api/fs${query}`).then(asJson<FsListing>);
  },
};
