import { type FormEvent, useState } from "react";

import { api, type Library, type LibraryKind } from "../api";

const KINDS: LibraryKind[] = ["anime", "movie", "series"];
const fieldClass = "mt-1 w-full rounded-md bg-neutral-950 px-3 py-1.5 text-sm ring-1 ring-white/10";

interface Props {
  library: Library;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function LibrarySettings({ library, onClose, onSaved, onDeleted }: Props): JSX.Element {
  const [name, setName] = useState(library.name);
  const [kind, setKind] = useState<LibraryKind>(library.kind);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (reason: unknown): void => setError(String(reason));

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    api.updateLibrary(library.id, { name: name.trim(), kind }).then(onSaved).catch(fail);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[#120e1d] ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="font-semibold">Library settings</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        <form onSubmit={save} className="space-y-3 px-5 py-4">
          <label className="block text-sm">
            <span className="text-neutral-400">Name</span>
            <input
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-400">Type</span>
            <select
              className={fieldClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as LibraryKind)}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-500">
            Folder: <code className="text-neutral-400">{library.path}</code> — delete and re-add to
            change it.
          </p>
          {error !== null && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {confirmDelete ? (
              <button
                type="button"
                onClick={() => api.deleteLibrary(library.id).then(onDeleted).catch(fail)}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500"
              >
                Confirm delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-md px-3 py-1.5 text-sm text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/10"
              >
                Delete library
              </button>
            )}
            <button
              type="submit"
              className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white transition hover:from-violet-500 hover:to-fuchsia-500"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
