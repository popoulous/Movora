import { type TFunction } from "i18next";
import { Check, Star } from "lucide-react";

// The minimal shape both SeriesSummary and HomeSeries satisfy.
export interface CardSeries {
  id: number;
  title: string;
  display_title: string | null;
  year: number | null;
  score: number | null;
  cover_image_url: string | null;
  episode_count: number;
  watch_percent: number;
  normalized?: boolean;
}

// A green check badge marking a fully optimized (Direct-Play ready) series.
function OptimizedBadge({ title }: { title: string }): JSX.Element {
  return (
    <span
      title={title}
      className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow ring-2 ring-black/25"
    >
      <Check className="h-3 w-3 text-white" strokeWidth={3} />
    </span>
  );
}

export const cardTitle = (series: CardSeries): string => series.display_title ?? series.title;

export function ScoreBadge({ score }: { score: number }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-amber-300 backdrop-blur">
      <Star className="h-3 w-3 fill-current" />
      {(score / 10).toFixed(1)}
    </span>
  );
}

function Poster({ series }: { series: CardSeries }): JSX.Element {
  if (series.cover_image_url !== null) {
    return (
      <img
        src={series.cover_image_url}
        alt={cardTitle(series)}
        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30 p-3 text-center text-sm text-neutral-300">
      {cardTitle(series)}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }): JSX.Element {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
      <div
        className="h-full bg-gradient-to-r from-[#7A4DFF] to-[#EC4899]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function SeriesCard({
  series,
  onClick,
  t,
  className = "",
}: {
  series: CardSeries;
  onClick: () => void;
  t: TFunction;
  className?: string;
}): JSX.Element {
  return (
    <button onClick={onClick} className={`group text-left ${className}`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition group-hover:ring-violet-400/40">
        <Poster series={series} />
        {series.score !== null && (
          <span className="absolute top-1.5 right-1.5">
            <ScoreBadge score={series.score} />
          </span>
        )}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
          <div className="line-clamp-2 text-sm font-semibold text-white">{cardTitle(series)}</div>
          <div className="mt-1 text-xs text-neutral-300">
            {t("library.episodesShort", { count: series.episode_count })}
          </div>
          {series.watch_percent > 0 && (
            <div className="text-xs font-medium text-violet-300">
              {t("library.watchedPercent", { percent: series.watch_percent })}
            </div>
          )}
        </div>
        {series.watch_percent > 0 && <ProgressBar percent={series.watch_percent} />}
        {series.normalized === true && <OptimizedBadge title={t("series.optimized")} />}
      </div>
      <div className="mt-2 truncate text-sm font-medium">{cardTitle(series)}</div>
      {series.year !== null && <div className="text-xs text-neutral-500">{series.year}</div>}
    </button>
  );
}

export function SeriesRow({
  series,
  onClick,
  t,
}: {
  series: CardSeries;
  onClick: () => void;
  t: TFunction;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl bg-white/[0.02] p-2.5 text-left ring-1 ring-white/[0.06] transition hover:bg-white/[0.05]"
    >
      <div className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
        <Poster series={series} />
        {series.watch_percent > 0 && <ProgressBar percent={series.watch_percent} />}
        {series.normalized === true && <OptimizedBadge title={t("series.optimized")} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-neutral-100">{cardTitle(series)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
          {series.year !== null && <span>{series.year}</span>}
          <span>{t("library.episodesShort", { count: series.episode_count })}</span>
          {series.score !== null && (
            <span className="inline-flex items-center gap-0.5 text-amber-300">
              <Star className="h-3 w-3 fill-current" />
              {(series.score / 10).toFixed(1)}
            </span>
          )}
          {series.watch_percent > 0 && (
            <span className="text-violet-300">
              {t("library.watchedPercent", { percent: series.watch_percent })}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
