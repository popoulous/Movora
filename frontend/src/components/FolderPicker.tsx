import { type FormEvent, useEffect, useState } from "react";

import { api, type FsListing, type Library, type LibraryKind } from "../api";

const KINDS: LibraryKind[] = ["anime", "movie", "series"];

interface Props {
  onClose: () => void;
  onAdded: (library: Library) => void;
}

function basename(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? path
  );
}

export function FolderPicker({ onClose, onAdded }: Props): JSX.Element {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LibraryKind>("anime");
  const [error, setError] = useState<string | null>(null);

  const browse = (path?: string): void => {
    setError(null);
    api
      .browseFs(path)
      .then(setListing)
      .catch((reason: unknown) => setError(String(reason)));
  };

  useEffect(() => browse(undefined), []);

  const currentPath = listing?.path ?? null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (currentPath === null) {
      setError("Open a folder first, then add it.");
      return;
    }
    api
      .createLibrary({ path: currentPath, name: name.trim() || basename(currentPath), kind })
      .then(onAdded)
      .catch((reason: unknown) => setError(String(reason)));
  };

  const canGoUp = listing !== null && listing.parent !== null;
  const canGoToRoots = currentPath !== null; // back out to drive/root list

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-[#120e1d] ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="font-semibold">Add library</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="px-5 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <button
              onClick={() => browse(listing?.parent ?? undefined)}
              disabled={!canGoUp && !canGoToRoots}
              className="rounded px-2 py-1 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
            >
              ◂ Up
            </button>
            <code className="truncate text-neutral-400">{currentPath ?? "This PC"}</code>
          </div>

          <ul className="h-56 overflow-auto rounded-md bg-neutral-950/50 ring-1 ring-white/10">
            {listing?.directories.map((dir) => (
              <li key={dir.path}>
                <button
                  onClick={() => browse(dir.path)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/5"
                >
                  <span>📁</span>
                  <span className="truncate">{dir.name}</span>
                </button>
              </li>
            ))}
            {listing !== null && listing.directories.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-600">No sub-folders here</li>
            )}
          </ul>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3"
        >
          <input
            className="min-w-[8rem] flex-1 rounded-md bg-neutral-950 px-3 py-1.5 text-sm ring-1 ring-white/10 placeholder:text-neutral-500"
            placeholder={currentPath !== null ? basename(currentPath) : "Library name"}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            className="rounded-md bg-neutral-950 px-3 py-1.5 text-sm ring-1 ring-white/10"
            value={kind}
            onChange={(event) => setKind(event.target.value as LibraryKind)}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={currentPath === null}
            className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white transition hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-40"
          >
            Add this folder
          </button>
          {error !== null && <p className="w-full text-sm text-red-400">{error}</p>}
        </form>
      </div>
    </div>
  );
}
