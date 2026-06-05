import { type FormEvent, useEffect, useState } from "react";

import {
  api,
  type Library,
  type LibraryKind,
  type SeriesDetail,
  type SeriesSummary,
} from "./api";

const KINDS: LibraryKind[] = ["anime", "movie", "series"];

export function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [activeLibrary, setActiveLibrary] = useState<number | null>(null);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LibraryKind>("anime");

  const fail = (reason: unknown): void => setError(String(reason));

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
    api
      .scanLibrary(id)
      .then(() => openLibrary(id))
      .catch(fail);
  };

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>Movora</h1>
      {error !== null && <p style={{ color: "crimson" }}>Error: {error}</p>}

      <section>
        <h2>Add library</h2>
        <form onSubmit={addLibrary}>
          <input
            placeholder="Path (e.g. Z:\anime)"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            required
          />{" "}
          <input
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />{" "}
          <select value={kind} onChange={(event) => setKind(event.target.value as LibraryKind)}>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>{" "}
          <button type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2>Libraries</h2>
        <ul>
          {libraries.map((library) => (
            <li key={library.id}>
              <strong>{library.name}</strong> ({library.kind}) — <code>{library.path}</code>{" "}
              <button onClick={() => scan(library.id)}>Scan</button>{" "}
              <button onClick={() => openLibrary(library.id)}>Open</button>
            </li>
          ))}
        </ul>
      </section>

      {activeLibrary !== null && (
        <section>
          <h2>Series</h2>
          <ul>
            {series.map((summary) => (
              <li key={summary.id}>
                <button onClick={() => api.getSeries(summary.id).then(setDetail).catch(fail)}>
                  {summary.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail !== null && (
        <section>
          <h2>{detail.title}</h2>
          {detail.seasons.map((season) => (
            <div key={season.id}>
              <h3>Season {season.number}</h3>
              <ul>
                {[...season.episodes]
                  .sort((a, b) => a.number - b.number)
                  .map((episode) => (
                    <li key={episode.id}>
                      {episode.number}. {episode.title ?? "(untitled)"}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
