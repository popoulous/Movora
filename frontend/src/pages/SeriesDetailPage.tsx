import { Check, Lock, Play, Plus, Star } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, type Recommendation, type SeriesDetail, type SeriesWatch } from "../api";

type Tab = "episodes" | "overview";

const COMING_SOON = ["tabCharacters", "tabReviews", "tabStats"] as const;

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(iso: string | null, locale: string): string | null {
  if (iso === null) return null;
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Season 0 = specials/OVAs: sort it after the numbered seasons and label it accordingly.
function seasonOrder(number: number): number {
  return number === 0 ? Number.MAX_SAFE_INTEGER : number;
}

function seasonLabel(number: number, t: TFunction): string {
  return number === 0 ? t("series.season0") : t("series.season", { number });
}

function Stat({ value, label }: { value: ReactNode; label: string }): JSX.Element {
  return (
    <div className="min-w-[80px]">
      <div className="text-2xl font-semibold text-neutral-50">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export function SeriesDetailPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const seriesId = Number(id);
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [tab, setTab] = useState<Tab>("episodes");
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab("episodes");
    setSeasonId(null);
    api
      .getSeries(seriesId)
      .then((detail) => {
        setSeries(detail);
        const ordered = [...detail.seasons].sort(
          (a, b) => seasonOrder(a.number) - seasonOrder(b.number),
        );
        setSeasonId(ordered[0]?.id ?? null);
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, [seriesId]);

  const orderedEpisodes = useMemo(
    () =>
      series === null
        ? []
        : [...series.seasons]
            .sort((a, b) => a.number - b.number)
            .flatMap((season) => [...season.episodes].sort((a, b) => a.number - b.number)),
    [series],
  );

  if (error !== null) return <p className="text-sm text-red-400">{error}</p>;
  if (series === null) return <p className="text-sm text-neutral-500">{t("series.loading")}</p>;

  const watch = series.watch;
  const genres = series.genres?.split(", ").filter(Boolean) ?? [];
  const episodeCount = orderedEpisodes.length;
  const firstEpisode = orderedEpisodes[0];
  const continueId = watch?.continue_episode_id ?? firstEpisode?.id ?? null;
  const playContinue = (): void => {
    if (continueId !== null) navigate(`/watch/${continueId}`);
  };
  const ctaLabel = watch?.status === "completed" ? t("series.rewatch") : t("series.continueWatching");

  const score = series.score !== null ? (series.score / 10).toFixed(1) : null;
  const synopsis = series.description !== null ? stripHtml(series.description) : null;
  const aired =
    series.year === null
      ? null
      : series.end_year !== null && series.end_year !== series.year
        ? `${series.year}–${series.end_year}`
        : String(series.year);

  return (
    <div className="relative">
      {/* Full-bleed blurred banner backdrop behind the top of the page. */}
      <div className="pointer-events-none absolute -top-20 -right-6 -left-6 h-[560px] overflow-hidden">
        {series.banner_image_url !== null && (
          <img
            src={series.banner_image_url}
            alt=""
            className="h-full w-full scale-105 object-cover opacity-20 blur-[6px]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#05060B]/70 to-[#05060B]" />
      </div>

      <div className="relative">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-400 transition hover:text-white"
        >
          ◂ {t("series.back")}
        </button>

        <div className="mt-4 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---- Main column ---- */}
        <main className="min-w-0">
          <Hero
            series={series}
            score={score}
            aired={aired}
            episodeCount={episodeCount}
            genres={genres}
            synopsis={synopsis}
            ctaLabel={ctaLabel}
            canPlay={continueId !== null}
            onPlay={playContinue}
            t={t}
          />

          <Tabs tab={tab} setTab={setTab} t={t} />

          {tab === "overview" ? (
            <p className="max-w-3xl text-[15px] leading-[1.9] text-white/75">
              {synopsis ?? t("series.noSynopsis")}
            </p>
          ) : (
            <EpisodesSection
              series={series}
              seasonId={seasonId}
              setSeasonId={setSeasonId}
              continueId={watch?.continue_episode_id ?? null}
              navigate={navigate}
              t={t}
            />
          )}
        </main>

          {/* ---- Right rail ---- */}
          <aside className="space-y-4">
            <UserStatusCard watch={watch} locale={i18n.language} t={t} />
            {series.recommendations.length > 0 && (
              <RecommendationsPanel recommendations={series.recommendations} t={t} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Hero({
  series,
  score,
  aired,
  episodeCount,
  genres,
  synopsis,
  ctaLabel,
  canPlay,
  onPlay,
  t,
}: {
  series: SeriesDetail;
  score: string | null;
  aired: string | null;
  episodeCount: number;
  genres: string[];
  synopsis: string | null;
  ctaLabel: string;
  canPlay: boolean;
  onPlay: () => void;
  t: TFunction;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="relative w-56 shrink-0 self-start sm:w-64">
        <div className="rounded-3xl bg-gradient-to-br from-violet-500/60 to-fuchsia-500/60 p-px shadow-2xl shadow-violet-700/40">
          <div className="aspect-[2/3] overflow-hidden rounded-[23px]">
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
          onClick={onPlay}
          disabled={!canPlay}
          className="absolute bottom-4 left-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#7A4DFF] to-[#EC4899] text-white shadow-[0_0_40px_rgba(168,85,247,0.6)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-5 w-5 fill-current" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {series.display_title ?? series.title}
        </h1>
        {series.native_title !== null && (
          <p className="mt-1.5 text-lg text-white/60">{series.native_title}</p>
        )}

        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          {score !== null && (
            <Stat
              value={
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {score}
                </span>
              }
              label={t("series.rating")}
            />
          )}
          {aired !== null && <Stat value={aired} label={t("series.aired")} />}
          {series.format !== null && <Stat value={series.format} label={t("series.format")} />}
          <Stat value={String(episodeCount)} label={t("series.episodesLabel")} />
          {series.episode_duration !== null && (
            <Stat value={`${series.episode_duration}m`} label={t("series.perEp")} />
          )}
        </div>

        {synopsis !== null && (
          <p className="mt-5 line-clamp-3 max-w-[620px] text-[15px] leading-[1.8] text-white/70">
            {synopsis}
          </p>
        )}

        {genres.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {genres.map((genre) => (
              <span
                key={genre}
                className="gradient-border rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 px-3.5 py-1 text-xs font-medium text-neutral-100"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        <div className="mt-7 flex items-center gap-3">
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#7A4DFF] via-[#A855F7] to-[#EC4899] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_40px_rgba(168,85,247,0.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4 fill-current" /> {ctaLabel}
          </button>
          <button
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
            title={t("series.comingSoon")}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Tabs({
  tab,
  setTab,
  t,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  t: TFunction;
}): JSX.Element {
  const cls = (active: boolean): string =>
    `-mb-px border-b-2 px-1 py-2.5 text-sm font-medium transition ${
      active ? "border-violet-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
    }`;
  return (
    <div className="mt-8 mb-5 flex gap-6 border-b border-white/10">
      <button className={cls(tab === "episodes")} onClick={() => setTab("episodes")}>
        {t("series.tabEpisodes")}
      </button>
      <button className={cls(tab === "overview")} onClick={() => setTab("overview")}>
        {t("series.tabOverview")}
      </button>
      {COMING_SOON.map((label) => (
        <span
          key={label}
          title={t("series.comingSoon")}
          className="-mb-px inline-flex cursor-not-allowed items-center gap-1 border-b-2 border-transparent px-1 py-2.5 text-sm font-medium text-neutral-600"
        >
          {t(`series.${label}`)}
          <Lock className="h-3 w-3" />
        </span>
      ))}
    </div>
  );
}

function EpisodesSection({
  series,
  seasonId,
  setSeasonId,
  continueId,
  navigate,
  t,
}: {
  series: SeriesDetail;
  seasonId: number | null;
  setSeasonId: (id: number) => void;
  continueId: number | null;
  navigate: (to: string) => void;
  t: TFunction;
}): JSX.Element {
  const seasons = [...series.seasons].sort((a, b) => seasonOrder(a.number) - seasonOrder(b.number));
  const active = seasons.find((season) => season.id === seasonId) ?? seasons[0];
  const episodes = active ? [...active.episodes].sort((a, b) => a.number - b.number) : [];

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {seasons.length > 1 && (
        <div className="flex shrink-0 gap-2 sm:w-48 sm:flex-col">
          {seasons.map((season) => (
            <button
              key={season.id}
              onClick={() => setSeasonId(season.id)}
              className={`rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                season.id === active?.id
                  ? "bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-white ring-1 ring-violet-400/35"
                  : "text-neutral-400 ring-1 ring-transparent hover:bg-white/[0.03] hover:text-neutral-200"
              }`}
            >
              {seasonLabel(season.number, t)}
              <div className="text-xs font-normal text-neutral-500">
                {t("series.episodes", { count: season.episodes.length })}
              </div>
            </button>
          ))}
        </div>
      )}

      <ul className="min-w-0 flex-1 divide-y divide-white/5 overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/10 backdrop-blur">
        {episodes.map((episode) => {
          const selected = episode.id === continueId;
          return (
            <li
              key={episode.id}
              className={`flex items-center gap-4 px-5 py-3.5 text-sm transition ${
                selected ? "bg-[#7A4DFF]/[0.08]" : "hover:bg-[#7A4DFF]/[0.06]"
              }`}
            >
              <button
                onClick={() => navigate(`/watch/${episode.id}`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-neutral-300 ring-1 ring-white/10 transition hover:bg-[#7A4DFF]/30 hover:text-white"
              >
                <Play className="h-3 w-3 fill-current" />
              </button>
              <span className="w-6 text-right tabular-nums text-neutral-500">{episode.number}</span>
              <span className={`min-w-0 flex-1 truncate ${episode.watched ? "text-neutral-400" : "text-neutral-100"}`}>
                {episode.title ?? t("series.episode", { number: episode.number })}
              </span>
              {episode.watched && (
                <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-label="watched" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UserStatusCard({
  watch,
  locale,
  t,
}: {
  watch: SeriesWatch | null;
  locale: string;
  t: TFunction;
}): JSX.Element {
  const status = watch?.status ?? "not_started";
  const statusLabel =
    status === "completed"
      ? t("series.statusCompleted")
      : status === "watching"
        ? t("series.statusWatching")
        : t("series.statusNotStarted");
  const started = formatDate(watch?.started_at ?? null, locale);
  const finished = formatDate(watch?.finished_at ?? null, locale);

  return (
    <div className="rounded-2xl bg-[#0C0E19]/70 p-5 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">{t("series.yourStatus")}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status === "completed"
              ? "bg-emerald-500/15 text-emerald-300"
              : status === "watching"
                ? "bg-violet-500/15 text-violet-200"
                : "bg-white/5 text-neutral-400"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <Row
          label={t("series.episodesWatched")}
          value={`${watch?.episodes_watched ?? 0} / ${watch?.total ?? 0}`}
        />
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-400">
            <span>{t("series.progress")}</span>
            <span>{watch?.percent ?? 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7A4DFF] to-[#EC4899]"
              style={{ width: `${watch?.percent ?? 0}%` }}
            />
          </div>
        </div>
        {started !== null && <Row label={t("series.startDate")} value={started} />}
        {finished !== null && <Row label={t("series.finishDate")} value={finished} />}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className="font-medium text-neutral-100">{value}</span>
    </div>
  );
}

function RecommendationsPanel({
  recommendations,
  t,
}: {
  recommendations: Recommendation[];
  t: TFunction;
}): JSX.Element {
  return (
    <div className="rounded-2xl bg-[#0C0E19]/70 p-5 ring-1 ring-white/10 backdrop-blur">
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">{t("series.recommendations")}</h2>
      <div className="space-y-2">
        {recommendations.map((rec, index) => {
          const inner = (
            <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/[0.05] transition hover:bg-white/[0.05]">
              <div className="h-[72px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-white/5">
                {rec.cover_image_url !== null && (
                  <img src={rec.cover_image_url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-100">{rec.title}</div>
                {rec.score !== null && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-400">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {(rec.score / 10).toFixed(1)}
                  </div>
                )}
              </div>
            </div>
          );
          return rec.target_series_id !== null ? (
            <Link key={index} to={`/series/${rec.target_series_id}`}>
              {inner}
            </Link>
          ) : (
            <div key={index}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
