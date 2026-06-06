import { type TFunction } from "i18next";
import { CheckCircle2, ChevronLeft, ChevronRight, Play, Sparkles, Star } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type Collection, type HomeData, type HomeSeries, type HomeStats } from "../api";
import { SeriesCard } from "../components/SeriesCard";

const title = (s: HomeSeries): string => s.display_title ?? s.title;

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { running } = useActivity();
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getHome().then(setHome).catch((reason: unknown) => setError(String(reason)));
    if (!running) return;
    const timer = setInterval(() => {
      api.getHome().then(setHome).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [running]);

  if (error !== null) return <p className="text-sm text-red-400">{error}</p>;
  if (home === null) return <p className="text-sm text-neutral-500">{t("home.loading")}</p>;

  if (home.stats.series_count === 0) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-violet-400" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("home.emptyTitle")}</h1>
        <p className="mt-2 text-neutral-400">{t("home.emptyCta")}</p>
      </div>
    );
  }

  const open = (s: HomeSeries): void => {
    navigate(`/series/${s.id}`);
  };
  const play = (s: HomeSeries): void => {
    navigate(s.continue_episode_id !== null ? `/watch/${s.continue_episode_id}` : `/series/${s.id}`);
  };

  return (
    <div className="relative">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 25% 15%, rgba(122,77,255,.15), transparent 40%)," +
            "radial-gradient(circle at 75% 80%, rgba(236,72,153,.08), transparent 45%)",
        }}
      />

      {home.hero !== null && (
        <Hero hero={home.hero} onPlay={() => play(home.hero as HomeSeries)} t={t} />
      )}

      <div className="mt-8 space-y-8">
        {home.continue_watching.length > 0 && (
          <Row title={t("home.continueWatching")} items={home.continue_watching} onOpen={open} t={t} />
        )}
        {home.recently_added.length > 0 && (
          <Row title={t("home.recentlyAdded")} items={home.recently_added} onOpen={open} t={t} />
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-8">
            {home.recommendation !== null && (
              <Recommendation series={home.recommendation} onPlay={() => play(home.recommendation as HomeSeries)} t={t} />
            )}
            {home.collections.length > 0 && (
              <Collections items={home.collections} t={t} />
            )}
          </div>
          <div className="space-y-8">
            {home.recently_finished.length > 0 && (
              <FinishedList items={home.recently_finished} onOpen={open} t={t} />
            )}
            <Stats stats={home.stats} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({
  hero,
  onPlay,
  t,
}: {
  hero: HomeSeries;
  onPlay: () => void;
  t: TFunction;
}): JSX.Element {
  const score = hero.score !== null ? (hero.score / 10).toFixed(1) : null;
  const watching = hero.watch_status === "watching";
  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/10">
      <div className="absolute inset-0">
        {hero.banner_image_url !== null ? (
          <img
            src={hero.banner_image_url}
            alt=""
            className="h-full w-full scale-105 object-cover opacity-50 blur-[2px]"
          />
        ) : hero.cover_image_url !== null ? (
          <img
            src={hero.cover_image_url}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-30 blur-2xl"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-violet-900/50 to-fuchsia-900/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#05060B] via-[#05060B]/85 to-[#05060B]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05060B] to-transparent" />
      </div>

      <div className="relative flex min-h-[340px] flex-col justify-end gap-3 p-7 sm:p-10">
        <div className="text-xs font-semibold tracking-wide text-violet-300 uppercase">
          {watching ? t("home.continueWatching") : t("home.recommendation")}
        </div>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{title(hero)}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
          {score !== null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {score}
            </span>
          )}
          {hero.year !== null && <span>{hero.year}</span>}
          <span>{t("library.episodesShort", { count: hero.episode_count })}</span>
          {(hero.genres ?? "")
            .split(", ")
            .filter(Boolean)
            .slice(0, 3)
            .map((genre) => (
              <span key={genre} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs">
                {genre}
              </span>
            ))}
        </div>
        {hero.watch_percent > 0 && (
          <div className="h-1.5 w-72 max-w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7A4DFF] to-[#EC4899]"
              style={{ width: `${hero.watch_percent}%` }}
            />
          </div>
        )}
        <button
          onClick={onPlay}
          className="mt-2 inline-flex w-fit items-center gap-2 rounded-2xl bg-gradient-to-br from-[#7A4DFF] via-[#A855F7] to-[#EC4899] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_40px_rgba(168,85,247,0.4)] transition hover:brightness-110"
        >
          <Play className="h-4 w-4 fill-current" />
          {watching ? t("series.continueWatching") : t("series.play")}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-300 uppercase">
      {children}
    </h2>
  );
}

function Row({
  title: rowTitle,
  items,
  onOpen,
  t,
}: {
  title: string;
  items: HomeSeries[];
  onOpen: (s: HomeSeries) => void;
  t: TFunction;
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const scrollByPage = (direction: number): void => {
    const el = track.current;
    if (el !== null) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-300 uppercase">
          {rowTitle}
        </h2>
        <div className="flex gap-1.5">
          <CarouselArrow onClick={() => scrollByPage(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </CarouselArrow>
          <CarouselArrow onClick={() => scrollByPage(1)}>
            <ChevronRight className="h-4 w-4" />
          </CarouselArrow>
        </div>
      </div>
      <div ref={track} className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
        {items.map((s) => (
          <SeriesCard
            key={s.id}
            series={s}
            onClick={() => onOpen(s)}
            t={t}
            className="w-36 shrink-0"
          />
        ))}
      </div>
    </section>
  );
}

function CarouselArrow({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function Recommendation({
  series,
  onPlay,
  t,
}: {
  series: HomeSeries;
  onPlay: () => void;
  t: TFunction;
}): JSX.Element {
  const score = series.score !== null ? (series.score / 10).toFixed(1) : null;
  return (
    <section>
      <SectionTitle>{t("home.recommendation")}</SectionTitle>
      <div className="flex gap-5 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <div className="h-44 w-28 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
          {series.cover_image_url !== null ? (
            <img src={series.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30" />
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <h3 className="text-xl font-bold tracking-tight">{title(series)}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
            {score !== null && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Star className="h-3.5 w-3.5 fill-current" /> {score}
              </span>
            )}
            {series.year !== null && <span>{series.year}</span>}
            <span>{t("library.episodesShort", { count: series.episode_count })}</span>
          </div>
          {series.genres !== null && (
            <p className="mt-2 line-clamp-1 text-sm text-neutral-500">{series.genres}</p>
          )}
          <button
            onClick={onPlay}
            className="mt-auto inline-flex w-fit items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> {t("home.watchNow")}
          </button>
        </div>
      </div>
    </section>
  );
}

function Collections({ items, t }: { items: Collection[]; t: TFunction }): JSX.Element {
  return (
    <section>
      <SectionTitle>{t("home.collections")}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {items.map((collection) => (
          <span
            key={collection.genre}
            className="gradient-border rounded-full bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 px-3.5 py-1.5 text-sm text-neutral-100"
          >
            {collection.genre}
            <span className="ml-1.5 text-xs text-neutral-400">{collection.count}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function FinishedList({
  items,
  onOpen,
  t,
}: {
  items: HomeSeries[];
  onOpen: (s: HomeSeries) => void;
  t: TFunction;
}): JSX.Element {
  return (
    <section>
      <SectionTitle>{t("home.recentlyFinished")}</SectionTitle>
      <div className="space-y-1.5">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{title(s)}</span>
            <span className="shrink-0 text-xs text-neutral-500">{t("home.completed")}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Stats({ stats, t }: { stats: HomeStats; t: TFunction }): JSX.Element {
  const cells: { value: ReactNode; label: string }[] = [
    { value: stats.series_count, label: t("home.animeCount") },
    { value: stats.episode_count.toLocaleString(), label: t("home.episodeCount") },
    { value: stats.days_watched, label: t("home.daysWatched") },
  ];
  return (
    <section>
      <SectionTitle>{t("home.stats")}</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="rounded-xl bg-white/[0.03] p-4 text-center ring-1 ring-white/10"
          >
            <div className="text-2xl font-bold text-neutral-50">{cell.value}</div>
            <div className="mt-1 text-xs text-neutral-500">{cell.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
