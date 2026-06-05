import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { api, type Library } from "../api";
import { LibrariesContext } from "../LibrariesContext";
import { FolderPicker } from "./FolderPicker";

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `block truncate rounded-md px-2 py-1.5 ${
    isActive ? "bg-white/10 font-medium text-white" : "text-neutral-300 hover:bg-white/5"
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
        <aside className="w-60 shrink-0 border-r border-white/10 bg-neutral-900/50 p-4">
          <Link to="/" className="mb-6 block text-lg font-bold tracking-tight">
            <span className="text-indigo-400">▣</span> Movora
          </Link>

          <nav className="space-y-1 text-sm">
            <NavLink to="/" end className={navClass}>
              Home
            </NavLink>
          </nav>

          <div className="mt-6 mb-2 flex items-center justify-between px-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <span>Libraries</span>
            <button
              onClick={() => setPicking(true)}
              title="Add library"
              className="rounded px-1.5 text-base leading-none text-neutral-300 hover:bg-white/10"
            >
              +
            </button>
          </div>
          <nav className="space-y-1 text-sm">
            {libraries.map((library) => (
              <NavLink key={library.id} to={`/library/${library.id}`} className={navClass}>
                {library.name}
              </NavLink>
            ))}
            {libraries.length === 0 && (
              <p className="px-2 text-xs text-neutral-600">No libraries yet</p>
            )}
          </nav>

          <nav className="mt-6 space-y-1 text-sm">
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center border-b border-white/10 px-6 py-3">
            <div className="ml-auto flex items-center gap-2">
              <button title="Activity" className="rounded-md p-2 hover:bg-white/10">
                🔔
              </button>
              <button title="Language" className="rounded-md px-2 py-1 text-sm hover:bg-white/10">
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
