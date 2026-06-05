import { Play } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { api, type SeriesDetail } from "../api";

type Tab = "episodes" | "overview";

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Stat({ value, label }: { value: ReactNode; label: string }): JSX.Element {
  return (
    <div>
      <div className="text-base font-semibold text-neutral-100">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export function SeriesDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const seriesId = Number(id);
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [tab, setTab] = useState<Tab>("episodes");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab("episodes");
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
  const synopsis = series.description !== null ? stripHtml(series.description) : null;
  const aired =
    series.year === null
      ? null
      : series.end_year !== null && series.end_year !== series.year
        ? `${series.year}–${series.end_year}`
        : String(series.year);

  const tabClass = (value: Tab): string =>
    `-mb-px border-b-2 px-1 py-2 text-sm font-medium transition ${
      tab === value
        ? "border-violet-500 text-white"
        : "border-transparent text-neutral-400 hover:text-neutral-200"
    }`;

  return (
    <div className="space-y-6">
      {/* Full-bleed banner backdrop spanning the whole content area (no card box). */}
      <div className="relative -mx-6 -mt-16 overflow-hidden">
        {series.banner_image_url !== null && (
          <img
            src={series.banner_image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-25"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0812] via-[#0a0812]/70 to-transparent" />

        <div className="relative px-6 pt-6 pb-6">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-neutral-400 transition hover:text-white"
          >
            ◂ {t("series.back")}
          </button>

          <div className="mt-5 flex flex-col gap-6 lg:flex-row">
            <div className="relative w-48 shrink-0 self-start sm:w-56">
              <div className="rounded-xl bg-gradient-to-br from-violet-500/60 to-fuchsia-500/60 p-px shadow-2xl">
                <div className="aspect-[2/3] overflow-hidden rounded-[11px]">
                  {series.cover_image_url !== null ? (
                    <img
                      src={series.cover_image_url}
                      alt={series.display_title ?? series.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30" />
                  )}
                </div>
              </div>
              <button
                disabled
                title="Playback comes with the streaming layer"
                className="absolute bottom-3 left-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-400"
              >
                <Play className="h-5 w-5 fill-current" />
              </button>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="text-3xl font-bold tracking-tight">
                {series.display_title ?? series.title}
              </h1>
              {series.native_title !== null && (
                <p className="mt-1 text-sm text-neutral-400">{series.native_title}</p>
              )}

              <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
                {score !== null && (
                  <Stat
                    value={
                      <span>
                        <span className="text-amber-400">★</span> {score}
                      </span>
                    }
                    label={t("series.rating")}
                  />
                )}
                {aired !== null && <Stat value={aired} label={t("series.aired")} />}
                {series.format !== null && (
                  <Stat value={series.format} label={t("series.format")} />
                )}
                <Stat value={String(episodeCount)} label={t("series.episodesLabel")} />
                {series.episode_duration !== null && (
                  <Stat value={`${series.episode_duration}m`} label={t("series.perEp")} />
                )}
              </div>

              {synopsis !== null && (
                <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-relaxed text-neutral-300">
                  {synopsis}
                </p>
              )}

              {genres.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {genres.map((genre) => (
                    <span
                      key={genre}
                      className="gradient-border rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 px-3 py-1 text-xs font-medium text-neutral-100"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              <button
                disabled
                title="Playback comes with the streaming layer"
                className="mt-auto inline-flex cursor-not-allowed items-center gap-2 self-start rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-violet-900/30"
              >
                <Play className="h-4 w-4 fill-current" /> {t("series.play")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-6 border-b border-white/10">
        <button className={tabClass("episodes")} onClick={() => setTab("episodes")}>
          {t("series.tabEpisodes")}
        </button>
        <button className={tabClass("overview")} onClick={() => setTab("overview")}>
          {t("series.tabOverview")}
        </button>
      </div>

      {tab === "overview" ? (
        <p className="max-w-3xl text-sm leading-relaxed text-neutral-300">
          {synopsis ?? t("series.noSynopsis")}
        </p>
      ) : (
        <div className="space-y-6">
          {series.seasons.map((season) => (
            <section key={season.id}>
              <h2 className="mb-3 inline-flex items-center rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium ring-1 ring-white/10">
                {t("series.season", { number: season.number })}
              </h2>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
                {[...season.episodes]
                  .sort((a, b) => a.number - b.number)
                  .map((episode) => (
                    <li
                      key={episode.id}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-white/5"
                    >
                      <button
                        disabled
                        title="Playback comes with the streaming layer"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-neutral-300 ring-1 ring-white/10"
                      >
                        <Play className="h-3 w-3 fill-current" />
                      </button>
                      <span className="w-6 text-right tabular-nums text-neutral-500">
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
