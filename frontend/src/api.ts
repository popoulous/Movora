export type LibraryKind = "anime" | "movie" | "series";

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
  score: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  episode_count: number;
  watch_status: WatchStatus;
  watch_percent: number;
  normalized: boolean;
  continue_episode_id: number | null;
  continue_episode_number: number | null;
  continue_percent: number;
  continue_position_seconds: number;
  continue_thumbnail_url: string | null;
  last_watched_at: string | null;
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

export interface Recommendation {
  title: string;
  cover_image_url: string | null;
  score: number | null;
  target_series_id: number | null;
}

export interface Character {
  name: string;
  image_url: string | null;
  role: string | null; // MAIN | SUPPORTING
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
  characters: Character[];
  watch: SeriesWatch | null;
}

export interface HomeSeries {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  score: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  genres: string | null;
  episode_count: number;
  watch_status: WatchStatus;
  watch_percent: number;
  continue_episode_id: number | null;
  normalized: boolean;
}

export interface Collection {
  genre: string;
  count: number;
}

export interface HomeStats {
  series_count: number;
  episode_count: number;
  episodes_watched: number;
  days_watched: number;
}

export interface HomeData {
  hero: HomeSeries | null;
  continue_watching: HomeSeries[];
  recently_added: HomeSeries[];
  recently_finished: HomeSeries[];
  recommendation: HomeSeries | null;
  collections: Collection[];
  stats: HomeStats;
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
  score: number | null;
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
  delete_original: boolean;
  auto_detect_intro: boolean;
  tmdb_language: string;
}

export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface Task {
  id: number;
  type: string; // "scan" | "metadata" | "normalize"
  status: TaskStatus;
  progress: number;
  eta_seconds: number | null;
  message: string | null;
  finished_at: string | null;
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

// A 401 mid-session means the cookie expired; let the app drop back to the login gate.
function checkOk(response: Response): void {
  if (response.status === 401) {
    window.dispatchEvent(new Event("movora:unauthorized"));
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
}

async function asJson<T>(response: Response): Promise<T> {
  checkOk(response);
  return (await response.json()) as T;
}

function throwIfNotOk(response: Response): void {
  checkOk(response);
}

export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  preferred_language: string | null;
  library_ids: number[];
}

export interface AuthStatus {
  authenticated: boolean;
  needs_setup: boolean;
  user: User | null;
}

export interface SearchResult {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  cover_image_url: string | null;
  library_id: number;
  library_kind: string;
}

export const api = {
  authStatus: (): Promise<AuthStatus> => fetch("/api/auth/status").then(asJson<AuthStatus>),
  setup: (username: string, password: string): Promise<User> =>
    fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(asJson<User>),
  login: (username: string, password: string): Promise<User> =>
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(asJson<User>),
  logout: (): Promise<void> => fetch("/api/auth/logout", { method: "POST" }).then(throwIfNotOk),
  updatePreferences: (body: { preferred_language: string | null }): Promise<User> =>
    fetch("/api/auth/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<User>),
  listUsers: (): Promise<User[]> => fetch("/api/auth/users").then(asJson<User[]>),
  createUser: (body: { username: string; password: string; role: "admin" | "user" }): Promise<User> =>
    fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<User>),
  deleteUser: (id: number): Promise<void> =>
    fetch(`/api/auth/users/${id}`, { method: "DELETE" }).then(throwIfNotOk),
  setUserLibraries: (id: number, libraryIds: number[]): Promise<User> =>
    fetch(`/api/auth/users/${id}/libraries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ library_ids: libraryIds }),
    }).then(asJson<User>),
  search: (q: string): Promise<SearchResult[]> =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then(asJson<SearchResult[]>),
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
  getHome: (): Promise<HomeData> => fetch("/api/home").then(asJson<HomeData>),
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
  normalizeSeries: (seriesId: number): Promise<void> =>
    fetch(`/api/series/${seriesId}/normalize`, { method: "POST" }).then(throwIfNotOk),
  listTasks: (): Promise<Task[]> => fetch("/api/tasks").then(asJson<Task[]>),
  cancelTasks: (ids: number[]): Promise<void> =>
    fetch("/api/tasks/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then(throwIfNotOk),
  normalizeAll: (): Promise<void> =>
    fetch("/api/normalize/all", { method: "POST" }).then(throwIfNotOk),
  detectIntros: (): Promise<void> =>
    fetch("/api/intro/detect", { method: "POST" }).then(throwIfNotOk),
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
