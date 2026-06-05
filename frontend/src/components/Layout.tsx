import { Bell, Film, Home, type LucideIcon, Plus, Settings, Sparkles, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { api, type Library, type LibraryKind } from "../api";
import { LibrariesContext } from "../LibrariesContext";
import { FolderPicker } from "./FolderPicker";

const KIND_ICON: Record<LibraryKind, LucideIcon> = {
  anime: Sparkles,
  movie: Film,
  series: Tv,
};

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
    isActive
      ? "bg-violet-500/15 font-medium text-white ring-1 ring-violet-400/20"
      : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
  }`;

export function Layout(): JSX.Element {
  const { t, i18n } = useTranslation();
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

  const onAdded = (library: Library): void => {
    setPicking(false);
    loadLibraries();
    navigate(`/library/${library.id}`);
  };

  const lang = i18n.language.startsWith("hu") ? "hu" : "en";
  const toggleLang = (): void => {
    const next = lang === "hu" ? "en" : "hu";
    void i18n.changeLanguage(next);
    localStorage.setItem("movora.lang", next);
  };

  return (
    <LibrariesContext.Provider value={{ libraries, reload: loadLibraries }}>
      <div className="flex min-h-screen">
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-[#0d0a16]/50 p-3 backdrop-blur">
          <Link to="/" className="mb-8 flex items-center gap-2 px-2 pt-2">
            <img src="/movora_logo.png" alt="" className="h-7 w-7" />
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center border-b border-white/5 px-6 py-3">
            <div className="ml-auto flex items-center gap-2">
              <button
                title={t("topbar.activity")}
                className="rounded-lg bg-white/5 p-2 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                <Bell className="h-4 w-4" />
              </button>
              <button
                title={t("topbar.language")}
                onClick={toggleLang}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                {lang.toUpperCase()}
              </button>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>

        {picking && <FolderPicker onClose={() => setPicking(false)} onAdded={onAdded} />}
      </div>
    </LibrariesContext.Provider>
  );
}
