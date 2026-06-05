import { type FormEvent, useEffect, useState } from "react";

import {
  api,
  type Library,
  type LibraryKind,
  type SeriesDetail,
  type SeriesSummary,
} from "./api";

const KINDS: LibraryKind[] = ["anime", "movie", "series"];

const btn =
  "rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium ring-1 ring-white/10 transition hover:bg-neutral-700";
const field =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-neutral-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none";
const sectionTitle = "mb-3 text-sm font-semibold tracking-wide text-neutral-400 uppercase";

export function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [activeLibrary, setActiveLibrary] = useState<number | null>(null);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LibraryKind>("anime");

  const fail = (reason: unknown): void => {
    setBusy(null);
    setError(String(reason));
  };

  const loadLibraries = (): void => {
    api.listLibraries().then(setLibraries).catch(fail);
  };

  useEffect(loadLibraries, []);

  const openLibrary = (id: number): void => {
    setActiveLibrary(id);
    setDetail(null);
    api.listSeries(id).then(setSeries).catch(fail);
  };

  const addLibrary = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    api
      .createLibrary({ path, name, kind })
      .then(() => {
        setPath("");
        setName("");
        loadLibraries();
      })
      .catch(fail);
  };

  const scan = (id: number): void => {
    setBusy("Scanning…");
    api
      .scanLibrary(id)
      .then(() => {
        setBusy(null);
        openLibrary(id);
      })
      .catch(fail);
  };

  const enrich = (id: number): void => {
    setBusy("Fetching metadata…");
    api
      .enrichLibrary(id)
      .then(() => {
        setBusy(null);
        openLibrary(id);
      })
      .catch(fail);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-neutral-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="text-xl font-bold tracking-tight">
            Movora <span className="font-normal text-neutral-500">media server</span>
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {error !== null && (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
            {error}
          </div>
        )}

        <section>
          <h2 className={sectionTitle}>Add library</h2>
          <form onSubmit={addLibrary} className="flex flex-wrap gap-2">
            <input
              className={`${field} min-w-[14rem] flex-1`}
              placeholder="Path (e.g. Z:\anime)"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              required
            />
            <input
              className={field}
              placeholder="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <select
              className={field}
              value={kind}
              onChange={(event) => setKind(event.target.value as LibraryKind)}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button type="submit" className={btn}>
              Add
            </button>
          </form>
        </section>

        <section>
          <h2 className={sectionTitle}>Libraries</h2>
          <ul className="space-y-2">
            {libraries.map((library) => (
              <li
                key={library.id}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-white/10"
              >
                <span className="font-medium">{library.name}</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                  {library.kind}
                </span>
                <code className="truncate text-xs text-neutral-500">{library.path}</code>
                <div className="ml-auto flex gap-2">
                  <button className={btn} onClick={() => scan(library.id)}>
                    Scan
                  </button>
                  <button className={btn} onClick={() => enrich(library.id)}>
                    Fetch metadata
                  </button>
                  <button className={btn} onClick={() => openLibrary(library.id)}>
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {busy !== null && <p className="mt-2 text-sm text-indigo-400">{busy}</p>}
        </section>

        {activeLibrary !== null && (
          <section>
            <h2 className={sectionTitle}>Series ({series.length})</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {series.map((summary) => (
                <button
                  key={summary.id}
                  onClick={() => api.getSeries(summary.id).then(setDetail).catch(fail)}
                  className="group text-left"
                >
                  <div className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800 ring-1 ring-white/10">
                    {summary.cover_image_url !== null ? (
                      <img
                        src={summary.cover_image_url}
                        alt={summary.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 p-3 text-center text-sm text-neutral-300">
                        {summary.title}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium">{summary.title}</div>
                  {summary.year !== null && (
                    <div className="text-xs text-neutral-500">{summary.year}</div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {detail !== null && (
          <section className="rounded-lg bg-neutral-900 p-5 ring-1 ring-white/10">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">{detail.title}</h2>
              {detail.year !== null && <span className="text-neutral-500">{detail.year}</span>}
              <button className={`${btn} ml-auto`} onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            {detail.seasons.map((season) => (
              <div key={season.id} className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-neutral-400">
                  Season {season.number}
                </h3>
                <ul className="space-y-1">
                  {[...season.episodes]
                    .sort((a, b) => a.number - b.number)
                    .map((episode) => (
                      <li key={episode.id} className="text-sm text-neutral-300">
                        <span className="text-neutral-500">{episode.number}.</span>{" "}
                        {episode.title ?? "(untitled)"}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
