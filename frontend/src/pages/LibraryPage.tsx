import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type SeriesSummary } from "../api";
import { LibrarySettings } from "../components/LibrarySettings";
import { useLibraries } from "../LibrariesContext";

const secondary =
  "rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10";
const accent =
  "rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-fuchsia-500";

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { libraries, reload } = useLibraries();
  const { running } = useActivity();
  const library = libraries.find((item) => item.id === libraryId) ?? null;

  const [series, setSeries] = useState<SeriesSummary[]>([]);
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
    setError(null);
    api.listSeries(libraryId).then(setSeries).catch(fail);
    // While background work runs (e.g. auto-scan after adding the library), keep
    // refreshing so newly-indexed series appear without a manual reload.
    if (!running) return;
    const timer = setInterval(() => {
      api.listSeries(libraryId).then(setSeries).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [libraryId, running]);

  const scan = (): void => {
    setBusy(t("library.scanning"));
    api
      .scanLibrary(libraryId)
      .then(() => {
        setBusy(null);
        load();
      })
      .catch(fail);
  };

  const enrich = (): void => {
    setBusy(t("library.fetching"));
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
        <h1 className="text-2xl font-bold tracking-tight">
          {library?.name ?? t("library.defaultName")}
        </h1>
        <span className="text-sm text-neutral-500">
          {t("library.seriesCount", { count: series.length })}
        </span>
        <div className="ml-auto flex gap-2">
          <button className={secondary} onClick={scan}>
            {t("library.scan")}
          </button>
          <button className={accent} onClick={enrich}>
            {t("library.fetchMetadata")}
          </button>
          {library !== null && (
            <button
              className={secondary}
              title={t("library.settings")}
              onClick={() => setEditing(true)}
            >
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
        <p className="text-sm text-neutral-500">{t("library.noSeries")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {series.map((summary) => (
            <button
              key={summary.id}
              onClick={() => navigate(`/series/${summary.id}`)}
              className="group text-left"
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition group-hover:ring-violet-400/40">
                {summary.cover_image_url !== null ? (
                  <img
                    src={summary.cover_image_url}
                    alt={(summary.display_title ?? summary.title)}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30 p-3 text-center text-sm text-neutral-300">
                    {(summary.display_title ?? summary.title)}
                  </div>
                )}
                {summary.score !== null && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-amber-300 backdrop-blur">
                    <Star className="h-3 w-3 fill-current" />
                    {(summary.score / 10).toFixed(1)}
                  </span>
                )}
              </div>
              <div className="mt-2 truncate text-sm font-medium">{(summary.display_title ?? summary.title)}</div>
              {summary.year !== null && (
                <div className="text-xs text-neutral-500">{summary.year}</div>
              )}
            </button>
          ))}
        </div>
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
