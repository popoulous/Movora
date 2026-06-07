import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type SearchResult } from "../api";

export function GlobalSearch(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.search(query).then(setResults).catch(() => setResults([]));
    }, 200); // debounce keystrokes
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (id: number): void => {
    setOpen(false);
    setQuery("");
    navigate(`/series/${id}`);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur transition focus-within:ring-violet-400/40">
        <Search className="h-4 w-4 shrink-0 text-neutral-500" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          placeholder={t("search.placeholder")}
          className="w-36 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 transition-all focus:w-52 focus:outline-none"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 mt-2 max-h-96 w-72 overflow-auto rounded-xl bg-[#0C0E19]/95 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-neutral-500">{t("search.noResults")}</p>
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                onClick={() => go(result.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
              >
                <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-white/5">
                  {result.cover_image_url !== null && (
                    <img src={result.cover_image_url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm text-neutral-100">
                    {result.display_title ?? result.title}
                  </div>
                  {result.year !== null && (
                    <div className="text-xs text-neutral-500">{result.year}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
