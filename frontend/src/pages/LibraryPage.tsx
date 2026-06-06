import { LayoutGrid, List, Play, Search, Settings, Sparkles, Star } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type SeriesSummary, type WatchStatus } from "../api";
import { LibrarySettings } from "../components/LibrarySettings";
import { SeriesCard, SeriesRow } from "../components/SeriesCard";
import { useLibraries } from "../LibrariesContext";

type Filter = "all" | WatchStatus;
type View = "grid" | "list";

const seriesTitle = (s: SeriesSummary): string => s.display_title ?? s.title;

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { libraries, reload } = useLibraries();
  const { running } = useActivity();
  const library = libraries.find((item) => item.id === libraryId) ?? null;

  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");
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
    setSearch("");
    setFilter("all");
    api.listSeries(libraryId).then(setSeries).catch(fail);
    // Keep refreshing while background work runs (auto-scan/metadata after adding).
    if (!running) return;
    const timer = setInterval(() => {
      api.listSeries(libraryId).then(setSeries).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [libraryId, running]);

  const run = (action: () => Promise<void>, label: string): void => {
    setBusy(label);
    action()
      .then(() => {
        setBusy(null);
        load();
      })
      .catch(fail);
  };

  const featured = useMemo(() => {
    if (series.length === 0) return null;
    return (
      series.find((s) => s.watch_status === "watching") ??
      [...series].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    );
  }, [series]);

  const query = search.trim().toLowerCase();
  const browsing = query === "" && filter === "all";
  const filtered = series.filter((s) => {
    const matchesSearch = query === "" || seriesTitle(s).toLowerCase().includes(query);
    const matchesFilter = filter === "all" || s.watch_status === filter;
    return matchesSearch && matchesFilter;
  });
  const watching = series.filter((s) => s.watch_status === "watching");
  const recentlyAdded = [...series].sort((a, b) => b.id - a.id).slice(0, 12);

  const open = (s: SeriesSummary): void => {
    navigate(`/series/${s.id}`);
  };

  return (
    <div className="relative">
      {/* Ambient glows behind the whole page. */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 25% 15%, rgba(122,77,255,.15), transparent 40%)," +
            "radial-gradient(circle at 75% 80%, rgba(236,72,153,.08), transparent 45%)",
        }}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-5 w-5 text-violet-300" />
        <h1 className="text-2xl font-bold tracking-tight">
          {library?.name ?? t("library.defaultName")}
        </h1>
        <span className="text-sm text-neutral-500">
          {t("library.seriesCount", { count: series.length })}
        </span>
        <div className="ml-auto flex gap-2">
          <ToolbarButton onClick={() => run(() => api.scanLibrary(libraryId), t("library.scanning"))}>
            {t("library.scan")}
          </ToolbarButton>
          <button
            onClick={() => run(() => api.enrichLibrary(libraryId), t("library.fetching"))}
            className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110"
          >
            {t("library.fetchMetadata")}
          </button>
          {library !== null && (
            <ToolbarButton onClick={() => setEditing(true)} title={t("library.settings")}>
              <Settings className="h-4 w-4" />
            </ToolbarButton>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}
      {busy !== null && <p className="mt-3 text-sm text-violet-300">{busy}</p>}

      {/* Hero */}
      {featured !== null && <Hero featured={featured} onPlay={() => open(featured)} t={t} />}

      {/* Toolbar: search + filters + view toggle */}
      {series.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("library.search")}
              className="w-[320px] max-w-full rounded-xl bg-white/[0.04] py-2.5 pr-3 pl-9 text-sm text-neutral-100 ring-1 ring-white/10 backdrop-blur transition placeholder:text-neutral-500 focus:bg-white/[0.07] focus:ring-violet-400/40 focus:outline-none"
            />
          </div>
          <div className="flex gap-1.5">
            {(["all", "watching", "completed"] as const).map((value) => (
              <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
                {t(`library.filter${value[0].toUpperCase()}${value.slice(1)}`)}
              </Chip>
            ))}
          </div>
          <div className="ml-auto flex gap-1 rounded-lg bg-white/[0.04] p-1 ring-1 ring-white/10">
            <ViewToggle active={view === "grid"} onClick={() => setView("grid")} title={t("library.gridView")}>
              <LayoutGrid className="h-4 w-4" />
            </ViewToggle>
            <ViewToggle active={view === "list"} onClick={() => setView("list")} title={t("library.listView")}>
              <List className="h-4 w-4" />
            </ViewToggle>
          </div>
        </div>
      )}

      {/* Content */}
      {series.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">{t("library.noSeries")}</p>
      ) : browsing ? (
        <div className="mt-6 space-y-8">
          {watching.length > 0 && (
            <Section title={t("library.continueWatching")}>
              <Grid items={watching} view="grid" onOpen={open} t={t} />
            </Section>
          )}
          {series.length > 12 && (
            <Section title={t("library.recentlyAdded")}>
              <Grid items={recentlyAdded} view="grid" onOpen={open} t={t} />
            </Section>
          )}
          <Section title={t("library.allAnime")}>
            <Grid items={series} view={view} onOpen={open} t={t} />
          </Section>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">{t("library.noMatch")}</p>
      ) : (
        <div className="mt-6">
          <Grid items={filtered} view={view} onOpen={open} t={t} />
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

function ToolbarButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] text-white shadow-[0_0_20px_rgba(122,77,255,0.25)]"
          : "bg-white/[0.04] text-neutral-300 ring-1 ring-white/10 hover:bg-white/[0.08]"
      }`}
    >
      {children}
    </button>
  );
}

function ViewToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 transition ${
        active ? "bg-white/10 text-white" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-300 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Hero({
  featured,
  onPlay,
  t,
}: {
  featured: SeriesSummary;
  onPlay: () => void;
  t: TFunction;
}): JSX.Element {
  const title = seriesTitle(featured);
  const score = featured.score !== null ? (featured.score / 10).toFixed(1) : null;
  return (
    <div className="relative mt-5 overflow-hidden rounded-3xl ring-1 ring-white/10">
      <div className="absolute inset-0">
        {featured.banner_image_url !== null ? (
          <img
            src={featured.banner_image_url}
            alt=""
            className="h-full w-full scale-105 object-cover opacity-40 blur-[2px]"
          />
        ) : featured.cover_image_url !== null ? (
          <img
            src={featured.cover_image_url}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-30 blur-xl"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-violet-900/50 to-fuchsia-900/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#05060B] via-[#05060B]/80 to-[#05060B]/30" />
      </div>

      <div className="relative flex items-end gap-5 p-6 sm:p-8">
        {featured.cover_image_url !== null && (
          <div className="hidden h-44 w-28 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/15 sm:block">
            <img src={featured.cover_image_url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="min-w-0">
          {featured.watch_status === "watching" && (
            <div className="mb-1.5 text-xs font-semibold tracking-wide text-violet-300 uppercase">
              {t("library.continueWatching")}
            </div>
          )}
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          <div className="mt-2 flex items-center gap-3 text-sm text-neutral-300">
            {score !== null && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {score}
              </span>
            )}
            {featured.year !== null && <span>{featured.year}</span>}
            <span>{t("library.episodesShort", { count: featured.episode_count })}</span>
          </div>
          {featured.watch_percent > 0 && (
            <div className="mt-3 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7A4DFF] to-[#EC4899]"
                style={{ width: `${featured.watch_percent}%` }}
              />
            </div>
          )}
          <button
            onClick={onPlay}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#7A4DFF] via-[#A855F7] to-[#EC4899] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_40px_rgba(168,85,247,0.4)] transition hover:brightness-110"
          >
            <Play className="h-4 w-4 fill-current" />
            {featured.watch_status === "watching"
              ? t("series.continueWatching")
              : t("series.play")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Grid({
  items,
  view,
  onOpen,
  t,
}: {
  items: SeriesSummary[];
  view: View;
  onOpen: (s: SeriesSummary) => void;
  t: TFunction;
}): JSX.Element {
  if (view === "list") {
    return (
      <div className="space-y-2">
        {items.map((s) => (
          <SeriesRow key={s.id} series={s} onClick={() => onOpen(s)} t={t} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((s) => (
        <SeriesCard key={s.id} series={s} onClick={() => onOpen(s)} t={t} />
      ))}
    </div>
  );
}
