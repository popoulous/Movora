import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { api, type Library } from "../api";
import { LibrariesContext } from "../LibrariesContext";
import { FolderPicker } from "./FolderPicker";

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `block truncate rounded-lg px-3 py-2 text-sm transition ${
    isActive
      ? "bg-violet-500/15 font-medium text-white ring-1 ring-violet-400/20"
      : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
  }`;

export function Layout(): JSX.Element {
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

  return (
    <LibrariesContext.Provider value={{ libraries, reload: loadLibraries }}>
      <div className="flex min-h-screen">
        <aside className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-[#0d0a16]/50 p-3 backdrop-blur">
          <Link to="/" className="mb-6 flex items-center gap-2 px-2 pt-2">
            <img src="/movora_logo.png" alt="" className="h-7 w-7" />
            <span className="text-lg font-bold tracking-tight">Movora</span>
          </Link>

          <nav className="space-y-1">
            <NavLink to="/" end className={navClass}>
              Home
            </NavLink>
          </nav>

          <div className="mt-6 mb-1 flex items-center justify-between px-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <span>Libraries</span>
            <button
              onClick={() => setPicking(true)}
              title="Add library"
              className="rounded px-1 text-base leading-none text-neutral-400 hover:text-violet-300"
            >
              +
            </button>
          </div>
          <nav className="space-y-1">
            {libraries.map((library) => (
              <NavLink key={library.id} to={`/library/${library.id}`} className={navClass}>
                {library.name}
              </NavLink>
            ))}
            {libraries.length === 0 && (
              <p className="px-3 text-xs text-neutral-600">No libraries yet</p>
            )}
          </nav>

          <nav className="mt-6 space-y-1">
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center border-b border-white/5 px-6 py-3">
            <div className="ml-auto flex items-center gap-2">
              <button
                title="Activity"
                className="rounded-lg bg-white/5 p-2 text-sm ring-1 ring-white/10 hover:bg-white/10"
              >
                🔔
              </button>
              <button
                title="Language"
                className="rounded-lg bg-white/5 px-2.5 py-2 text-sm ring-1 ring-white/10 hover:bg-white/10"
              >
                EN ▾
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
