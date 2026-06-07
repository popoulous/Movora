import {
  ChevronsLeft,
  ChevronsRight,
  Film,
  Home,
  ListChecks,
  LogOut,
  type LucideIcon,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Tv,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { ActivityContext } from "../ActivityContext";
import { useAuth } from "../AuthContext";
import { api, type Library, type LibraryKind, type Task } from "../api";
import { LibrariesContext } from "../LibrariesContext";
import { ActivityBell } from "./ActivityBell";
import { FolderPicker } from "./FolderPicker";
import { GlobalSearch } from "./GlobalSearch";
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
  const { user, logout } = useAuth();
  const location = useLocation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [picking, setPicking] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false); // drawer on small screens
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebarCollapsed") === "1", // icon-only on desktop
  );
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]); // close the drawer on navigation

  const toggleCollapsed = (): void =>
    setCollapsed((value) => {
      localStorage.setItem("sidebarCollapsed", value ? "0" : "1");
      return !value;
    });
  const hide = collapsed ? "lg:hidden" : ""; // hide labels when desktop-collapsed
  const item = ({ isActive }: { isActive: boolean }): string =>
    `${navClass({ isActive })} ${collapsed ? "lg:justify-center lg:px-2" : ""}`;

  const loadLibraries = (): void => {
    api
      .listLibraries()
      .then(setLibraries)
      .catch(() => undefined);
  };

  useEffect(loadLibraries, []);

  // Activity polling, shared via context so any page can show/refresh progress.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [optimistic, setOptimistic] = useState(false);
  const boostUntil = useRef(0);
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      api
        .listTasks()
        .then((next) => {
          if (!active) return;
          setTasks(next);
          const busy = next.some((task) => task.status === "running" || task.status === "pending");
          if (busy) setOptimistic(false);
          const fast = busy || Date.now() < boostUntil.current;
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

  const running =
    optimistic || tasks.some((task) => task.status === "running" || task.status === "pending");

  const onAdded = (library: Library): void => {
    setPicking(false);
    loadLibraries();
    navigate(`/library/${library.id}`);
  };

  return (
    <LibrariesContext.Provider value={{ libraries, reload: loadLibraries }}>
      <ActivityContext.Provider value={{ tasks, running, refreshSoon }}>
        <div className="flex h-screen overflow-hidden">
        {mobileOpen && (
          <button
            aria-label={t("nav.menu")}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-[#080a12]/95 py-8 backdrop-blur-2xl transition-[transform,width] duration-300 lg:static lg:z-auto lg:translate-x-0 lg:bg-[#080a12]/[0.72] ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          } ${collapsed ? "px-3 lg:w-[78px]" : "px-5"}`}
        >
          <Link
            to="/"
            className={`mb-8 flex items-center gap-2.5 px-1 ${collapsed ? "lg:justify-center" : ""}`}
          >
            <img
              src="/movora_logo.png"
              alt=""
              className="h-9 w-9 shrink-0 drop-shadow-[0_0_30px_rgba(122,77,255,0.35)]"
            />
            <span className={`text-lg font-bold tracking-tight ${hide}`}>Movora</span>
          </Link>

          <nav className="space-y-1">
            <NavLink to="/" end className={item}>
              <Home className="h-4 w-4 shrink-0" />
              <span className={hide}>{t("nav.home")}</span>
            </NavLink>
          </nav>

          <div
            className={`mt-8 mb-2 flex items-center justify-between px-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <span className={hide}>{t("nav.libraries")}</span>
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
                <NavLink
                  key={library.id}
                  to={`/library/${library.id}`}
                  className={item}
                  title={library.name}
                >
                  <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                  <span className={`min-w-0 flex-1 truncate ${hide}`}>{library.name}</span>
                  {library.series_count > 0 && (
                    <span
                      className={`shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] tabular-nums text-neutral-400 ${hide}`}
                    >
                      {library.series_count}
                    </span>
                  )}
                </NavLink>
              );
            })}
            {libraries.length === 0 && (
              <p className={`px-3 py-2 text-xs text-neutral-600 ${hide}`}>{t("nav.noLibraries")}</p>
            )}
          </nav>

          <nav className="mt-auto space-y-1 pt-8">
            <NavLink to="/tasks" className={item}>
              <ListChecks className="h-4 w-4 shrink-0" />
              <span className={hide}>{t("nav.tasks")}</span>
            </NavLink>
            <NavLink to="/settings" className={item}>
              <Settings className="h-4 w-4 shrink-0" />
              <span className={hide}>{t("nav.settings")}</span>
            </NavLink>
            {user !== null && (
              <button
                onClick={() => void logout()}
                title={t("nav.logout")}
                className={`flex w-full items-center gap-3 rounded-[14px] px-4 py-3 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200 ${
                  collapsed ? "lg:justify-center lg:px-2" : ""
                }`}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className={`min-w-0 flex-1 truncate text-left ${hide}`}>{user.username}</span>
              </button>
            )}
            <button
              onClick={toggleCollapsed}
              title={t("nav.collapse")}
              className={`hidden w-full items-center gap-3 rounded-[14px] px-4 py-3 text-sm text-neutral-500 transition hover:bg-white/5 hover:text-neutral-200 lg:flex ${
                collapsed ? "lg:justify-center lg:px-2" : ""
              }`}
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronsLeft className="h-4 w-4 shrink-0" />
              )}
              <span className={hide}>{t("nav.collapse")}</span>
            </button>
          </nav>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-4 py-3 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label={t("nav.menu")}
              className="pointer-events-auto rounded-lg bg-white/5 p-2 text-neutral-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/10 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="pointer-events-auto">
              <GlobalSearch />
            </div>
            <div className="pointer-events-auto ml-auto flex items-center gap-2">
              <ActivityBell />
              <LanguageMenu />
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto px-4 pt-20 pb-6 sm:px-6">
            <Outlet />
          </main>
        </div>

        {picking && <FolderPicker onClose={() => setPicking(false)} onAdded={onAdded} />}
        </div>
      </ActivityContext.Provider>
    </LibrariesContext.Provider>
  );
}
