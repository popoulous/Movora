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
  seasons: Season[];
}

export interface ScanResult {
  added: number;
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
  listSeries: (libraryId: number): Promise<SeriesSummary[]> =>
    fetch(`/api/libraries/${libraryId}/series`).then(asJson<SeriesSummary[]>),
  getSeries: (id: number): Promise<SeriesDetail> =>
    fetch(`/api/series/${id}`).then(asJson<SeriesDetail>),
};
