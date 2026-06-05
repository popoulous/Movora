import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, type SeriesDetail, type SeriesSummary } from "../api";
import { LibrarySettings } from "../components/LibrarySettings";
import { useLibraries } from "../LibrariesContext";

const secondary =
  "rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10";
const accent =
  "rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-fuchsia-500";

export function LibraryPage(): JSX.Element {
  const { id } = useParams();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { libraries, reload } = useLibraries();
  const library = libraries.find((item) => item.id === libraryId) ?? null;

  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (reason: unknown): void => {
    setBusy(null);
    setError(String(reason));
  };

  const load = (): void => {
    api.listSeries(libraryId).then(setSeries).catch(fail);
  };

  useEffect(() => {
    setDetail(null);
    setError(null);
    api.listSeries(libraryId).then(setSeries).catch(fail);
  }, [libraryId]);

  const scan = (): void => {
    setBusy("Scanning…");
    api
      .scanLibrary(libraryId)
      .then(() => {
        setBusy(null);
        load();
      })
      .catch(fail);
  };

  const enrich = (): void => {
    setBusy("Fetching metadata…");
    api
      .enrichLibrary(libraryId)
      .then(() => {
        setBusy(null);
        load();
      })
      .catch(fail);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{library?.name ?? "Library"}</h1>
        <span className="text-sm text-neutral-500">{series.length} series</span>
        <div className="ml-auto flex gap-2">
          <button className={secondary} onClick={scan}>
            Scan
          </button>
          <button className={accent} onClick={enrich}>
            Fetch metadata
          </button>
          {library !== null && (
            <button className={secondary} title="Library settings" onClick={() => setEditing(true)}>
              ⚙
            </button>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}
      {busy !== null && <p className="text-sm text-violet-300">{busy}</p>}

      {series.length === 0 ? (
        <p className="text-sm text-neutral-500">No series yet — run a Scan.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {series.map((summary) => (
            <button
              key={summary.id}
              onClick={() => api.getSeries(summary.id).then(setDetail).catch(fail)}
              className="group text-left"
            >
              <div className="aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition group-hover:ring-violet-400/40">
                {summary.cover_image_url !== null ? (
                  <img
                    src={summary.cover_image_url}
                    alt={summary.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30 p-3 text-center text-sm text-neutral-300">
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
      )}

      {detail !== null && (
        <section className="rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-lg font-semibold">{detail.title}</h2>
            {detail.year !== null && <span className="text-neutral-500">{detail.year}</span>}
            <button className={`${secondary} ml-auto`} onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
          {detail.seasons.map((season) => (
            <div key={season.id} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-neutral-400">Season {season.number}</h3>
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

      {editing && library !== null && (
        <LibrarySettings
          library={library}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onDeleted={() => {
            setEditing(false);
            reload();
            navigate("/");
          }}
        />
      )}
    </div>
  );
}
