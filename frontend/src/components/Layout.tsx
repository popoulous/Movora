import { Film, Home, type LucideIcon, Plus, Settings, Sparkles, Tv } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { ActivityContext } from "../ActivityContext";
import { api, type Job, type Library, type LibraryKind } from "../api";
import { LibrariesContext } from "../LibrariesContext";
import { ActivityBell } from "./ActivityBell";
import { FolderPicker } from "./FolderPicker";
import { LanguageMenu } from "./LanguageMenu";

const KIND_ICON: Record<LibraryKind, LucideIcon> = {
  anime: Sparkles,
  movie: Film,
  series: Tv,
};

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-3 rounded-[14px] px-4 py-3 text-sm transition ${
    isActive
      ? "bg-gradient-to-r from-[#7A4DFF]/25 to-[#EC4899]/15 font-medium text-white shadow-[0_0_20px_rgba(122,77,255,0.2)] ring-1 ring-[#7A4DFF]/40"
      : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
  }`;

export function Layout(): JSX.Element {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [picking, setPicking] = useState(false);
  const navigate = useNavigate();

  const loadLibraries = (): void => {
    api
      .listLibraries()
      .then(setLibraries)
      .catch(() => undefined);
  };

  useEffect(loadLibraries, []);

  // Activity polling, shared via context so any page can show/refresh progress.
  const [jobs, setJobs] = useState<Job[]>([]);
  const [optimistic, setOptimistic] = useState(false);
  const boostUntil = useRef(0);
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      api
        .listJobs()
        .then((next) => {
          if (!active) return;
          setJobs(next);
          if (next.some((job) => job.status === "running")) setOptimistic(false);
          const boosting = Date.now() < boostUntil.current;
          const fast = boosting || next.some((job) => job.status === "running");
          timer = setTimeout(tick, fast ? 1500 : 8000);
        })
        .catch(() => {
          if (active) timer = setTimeout(tick, 8000);
        });
    };
    pollNow.current = () => {
      clearTimeout(timer);
      tick();
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const refreshSoon = useCallback(() => {
    boostUntil.current = Date.now() + 30000;
    setOptimistic(true);
    pollNow.current();
    window.setTimeout(() => setOptimistic(false), 12000);
  }, []);

  const running = optimistic || jobs.some((job) => job.status === "running");

  const onAdded = (library: Library): void => {
    setPicking(false);
    loadLibraries();
    navigate(`/library/${library.id}`);
  };

  return (
    <LibrariesContext.Provider value={{ libraries, reload: loadLibraries }}>
      <ActivityContext.Provider value={{ jobs, running, refreshSoon }}>
        <div className="flex min-h-screen">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-white/5 bg-[#080a12]/[0.72] px-5 py-8 backdrop-blur-2xl">
          <Link to="/" className="mb-8 flex items-center gap-2.5 px-1">
            <img
              src="/movora_logo.png"
              alt=""
              className="h-9 w-9 drop-shadow-[0_0_30px_rgba(122,77,255,0.35)]"
            />
            <span className="text-lg font-bold tracking-tight">Movora</span>
          </Link>

          <nav className="space-y-1">
            <NavLink to="/" end className={navClass}>
              <Home className="h-4 w-4 shrink-0" />
              {t("nav.home")}
            </NavLink>
          </nav>

          <div className="mt-8 mb-2 flex items-center justify-between px-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <span>{t("nav.libraries")}</span>
            <button
              onClick={() => setPicking(true)}
              title={t("nav.addLibrary")}
              className="-m-1 rounded p-1 text-neutral-400 transition hover:bg-white/10 hover:text-violet-300"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <nav className="space-y-1">
            {libraries.map((library) => {
              const Icon = KIND_ICON[library.kind];
              return (
                <NavLink key={library.id} to={`/library/${library.id}`} className={navClass}>
                  <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                  <span className="truncate">{library.name}</span>
                </NavLink>
              );
            })}
            {libraries.length === 0 && (
              <p className="px-3 py-2 text-xs text-neutral-600">{t("nav.noLibraries")}</p>
            )}
          </nav>

          <nav className="mt-auto space-y-1 pt-8">
            <NavLink to="/settings" className={navClass}>
              <Settings className="h-4 w-4 shrink-0" />
              {t("nav.settings")}
            </NavLink>
          </nav>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center px-6 py-3">
            <div className="pointer-events-auto ml-auto flex items-center gap-2">
              <ActivityBell />
              <LanguageMenu />
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto px-6 pt-20 pb-6">
            <Outlet />
          </main>
        </div>

        {picking && <FolderPicker onClose={() => setPicking(false)} onAdded={onAdded} />}
        </div>
      </ActivityContext.Provider>
    </LibrariesContext.Provider>
  );
}
