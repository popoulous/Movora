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
  end_year: number | null;
  format: string | null;
  episode_duration: number | null;
  score: number | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  description: string | null;
  genres: string | null;
  seasons: Season[];
}

export interface ScanResult {
  added: number;
}

export interface EnrichResult {
  enriched: number;
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

export interface Job {
  id: number;
  kind: string;
  library_id: number | null;
  status: string;
  message: string | null;
  created_at: string;
  finished_at: string | null;
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  listLibraries: (): Promise<Library[]> => fetch("/api/libraries").then(asJson<Library[]>),
  createLibrary: (body: { path: string; name: string; kind: LibraryKind }): Promise<Library> =>
    fetch("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(asJson<Library>),
  scanLibrary: (id: number): Promise<ScanResult> =>
    fetch(`/api/libraries/${id}/scan`, { method: "POST" }).then(asJson<ScanResult>),
  enrichLibrary: (id: number, force = false): Promise<EnrichResult> =>
    fetch(`/api/libraries/${id}/enrich${force ? "?force=true" : ""}`, { method: "POST" }).then(
      asJson<EnrichResult>,
    ),
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
  browseFs: (path?: string): Promise<FsListing> => {
    const query = path !== undefined ? `?path=${encodeURIComponent(path)}` : "";
    return fetch(`/api/fs${query}`).then(asJson<FsListing>);
  },
  listJobs: (): Promise<Job[]> => fetch("/api/jobs").then(asJson<Job[]>),
};
