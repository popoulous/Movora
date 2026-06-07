import { type TFunction } from "i18next";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Film,
  type LucideIcon,
  Sparkles,
  Tv,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type HomeData, type HomeSeries, type Library, type LibraryKind } from "../api";
import { useLibraries } from "../LibrariesContext";
import { SeriesCard } from "../components/SeriesCard";

const title = (s: HomeSeries): string => s.display_title ?? s.title;

const KIND_ICON: Record<LibraryKind, LucideIcon> = {
  anime: Sparkles,
  movie: Film,
  series: Tv,
};

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { running } = useActivity();
  const { libraries } = useLibraries();
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

      <div className="space-y-8">
        {home.continue_watching.length > 0 && (
          <Row title={t("home.continueWatching")} items={home.continue_watching} onOpen={open} t={t} />
        )}
        {home.recently_added.length > 0 && (
          <Row title={t("home.recentlyAdded")} items={home.recently_added} onOpen={open} t={t} />
        )}
        {home.recently_finished.length > 0 && (
          <FinishedList items={home.recently_finished} onOpen={open} t={t} />
        )}
        {libraries.length > 0 && <LibraryCards libraries={libraries} t={t} />}
      </div>
    </div>
  );
}

function LibraryCards({ libraries, t }: { libraries: Library[]; t: TFunction }): JSX.Element {
  const navigate = useNavigate();
  return (
    <section>
      <SectionTitle>{t("home.browseLibraries")}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {libraries.map((library) => {
          const Icon = KIND_ICON[library.kind];
          return (
            <button
              key={library.id}
              onClick={() => navigate(`/library/${library.id}`)}
              className="group flex items-center gap-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:ring-violet-400/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7A4DFF]/30 to-[#EC4899]/20 text-violet-200 ring-1 ring-white/10">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold text-neutral-100">{library.name}</span>
                <span className="block text-xs text-neutral-400">
                  {t("home.titleCount", { count: library.series_count })}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-violet-300" />
            </button>
          );
        })}
      </div>
    </section>
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
