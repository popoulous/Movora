import { Play, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { api, type SeriesDetail } from "../api";

type Tab = "overview" | "episodes";

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function SeriesDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const seriesId = Number(id);
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab("overview");
    api
      .getSeries(seriesId)
      .then(setSeries)
      .catch((reason: unknown) => setError(String(reason)));
  }, [seriesId]);

  if (error !== null) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (series === null) {
    return <p className="text-sm text-neutral-500">{t("series.loading")}</p>;
  }

  const genres = series.genres?.split(", ").filter(Boolean) ?? [];
  const episodeCount = series.seasons.reduce((total, season) => total + season.episodes.length, 0);
  const score = series.score !== null ? (series.score / 10).toFixed(1) : null;

  const tabClass = (value: Tab): string =>
    `px-3 py-2 text-sm font-medium transition ${
      tab === value
        ? "border-b-2 border-violet-400 text-white"
        : "text-neutral-400 hover:text-neutral-200"
    }`;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="text-sm text-neutral-400 transition hover:text-white"
      >
        ◂ {t("series.back")}
      </button>

      <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10">
        {series.banner_image_url !== null && (
          <img
            src={series.banner_image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-25"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0a0812] via-[#0a0812]/85 to-[#0a0812]/40" />
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row">
          <div className="group relative h-60 w-40 shrink-0 self-start">
            {series.cover_image_url !== null ? (
              <img
                src={series.cover_image_url}
                alt={series.title}
                className="h-full w-full rounded-xl object-cover shadow-xl ring-1 ring-white/10"
              />
            ) : (
              <div className="h-full w-full rounded-xl bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30 ring-1 ring-white/10" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600/85 text-white shadow-lg transition group-hover:scale-105">
                <Play className="h-5 w-5 fill-current" />
              </span>
            </span>
          </div>

          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{series.title}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              {score !== null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-2 py-1 font-medium text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-current" />
                  {score}
                </span>
              )}
              {series.year !== null && (
                <span className="rounded-md bg-white/5 px-2 py-1 ring-1 ring-white/10">
                  {series.year}
                </span>
              )}
              <span className="rounded-md bg-white/5 px-2 py-1 ring-1 ring-white/10">
                {t("series.episodes", { count: episodeCount })}
              </span>
            </div>

            {genres.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-neutral-300 ring-1 ring-white/10"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            <button
              disabled
              title="Playback comes with the streaming layer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-medium text-white opacity-50"
            >
              <Play className="h-4 w-4 fill-current" /> {t("series.play")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        <button className={tabClass("overview")} onClick={() => setTab("overview")}>
          {t("series.tabOverview")}
        </button>
        <button className={tabClass("episodes")} onClick={() => setTab("episodes")}>
          {t("series.tabEpisodes")}
        </button>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <p className="text-sm leading-relaxed text-neutral-300">
            {series.description !== null ? stripHtml(series.description) : t("series.noSynopsis")}
          </p>
          <aside className="h-fit space-y-2 rounded-xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {t("series.details")}
            </h2>
            {score !== null && <InfoRow label={t("series.scoreLabel")} value={`★ ${score}`} />}
            {series.year !== null && (
              <InfoRow label={t("series.yearLabel")} value={String(series.year)} />
            )}
            <InfoRow label={t("series.episodesLabel")} value={String(episodeCount)} />
            {genres.length > 0 && (
              <InfoRow label={t("series.genresLabel")} value={genres.join(", ")} />
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          {series.seasons.map((season) => (
            <section key={season.id}>
              <h2 className="mb-3 text-lg font-semibold">
                {t("series.season", { number: season.number })}
              </h2>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
                {[...season.episodes]
                  .sort((a, b) => a.number - b.number)
                  .map((episode) => (
                    <li
                      key={episode.id}
                      className="flex items-center gap-4 px-4 py-2.5 text-sm transition hover:bg-white/5"
                    >
                      <span className="w-8 text-right tabular-nums text-neutral-500">
                        {episode.number}
                      </span>
                      <span className="text-neutral-200">
                        {episode.title ?? t("series.untitled")}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-200">{value}</span>
    </div>
  );
}
