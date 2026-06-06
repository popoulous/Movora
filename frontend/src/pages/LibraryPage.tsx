import {
  Film,
  LayoutGrid,
  List,
  type LucideIcon,
  Search,
  Settings,
  Sparkles,
  Tv,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import { api, type LibraryKind, type SeriesSummary, type WatchStatus } from "../api";
import { LibrarySettings } from "../components/LibrarySettings";
import { SeriesCard, SeriesRow } from "../components/SeriesCard";
import { useLibraries } from "../LibrariesContext";

type Filter = "all" | WatchStatus;
type View = "grid" | "list";

const KIND_ICON: Record<LibraryKind, LucideIcon> = {
  anime: Sparkles,
  movie: Film,
  series: Tv,
};

const seriesTitle = (s: SeriesSummary): string => s.display_title ?? s.title;

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { libraries, reload } = useLibraries();
  const { running } = useActivity();
  const library = libraries.find((item) => item.id === libraryId) ?? null;
  const kind: LibraryKind = library?.kind ?? "anime";  // drives the kind-specific copy

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

  // The most recently watched series in this library, to resume from the top.
  const continueList = useMemo(
    () =>
      [...series]
        .filter((s) => s.watch_status === "watching")
        .sort((a, b) => (b.last_watched_at ?? "").localeCompare(a.last_watched_at ?? ""))
        .slice(0, 12),
    [series],
  );

  const query = search.trim().toLowerCase();
  const browsing = query === "" && filter === "all";
  const filtered = series.filter((s) => {
    const matchesSearch = query === "" || seriesTitle(s).toLowerCase().includes(query);
    const matchesFilter = filter === "all" || s.watch_status === filter;
    return matchesSearch && matchesFilter;
  });
  const recentlyAdded = [...series].sort((a, b) => b.id - a.id).slice(0, 12);

  const open = (s: SeriesSummary): void => {
    navigate(`/series/${s.id}`);
  };
  const resume = (s: SeriesSummary): void => {
    navigate(s.continue_episode_id !== null ? `/watch/${s.continue_episode_id}` : `/series/${s.id}`);
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
        {(() => {
          const KindIcon = library !== null ? KIND_ICON[library.kind] : Sparkles;
          return <KindIcon className="h-5 w-5 text-violet-300" />;
        })()}
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

      {/* Continue watching — resume the most recently watched series in this library. */}
      {continueList.length > 0 && (
        <div className="mt-5">
          <Section title={t("library.continueWatching")}>
            <Grid items={continueList} view="grid" onOpen={resume} t={t} />
          </Section>
        </div>
      )}

      {/* Toolbar: search + filters + view toggle */}
      {series.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(`library.search_${kind}`)}
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
          {series.length > 12 && (
            <Section title={t("library.recentlyAdded")}>
              <Grid items={recentlyAdded} view="grid" onOpen={open} t={t} />
            </Section>
          )}
          <Section title={t(`library.all_${kind}`)}>
            <Grid items={series} view={view} onOpen={open} t={t} />
          </Section>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">{t(`library.noMatch_${kind}`)}</p>
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
