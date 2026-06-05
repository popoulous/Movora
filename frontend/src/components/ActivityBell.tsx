import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type Job } from "../api";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusDot(status: string): string {
  const color =
    status === "failed" ? "bg-red-400" : status === "running" ? "bg-violet-400" : "bg-emerald-400";
  return `h-2 w-2 shrink-0 rounded-full ${color}`;
}

export function ActivityBell(): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const load = (): void => {
      api.listJobs().then(setJobs).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  const kindLabel = (kind: string): string =>
    kind === "enrich" ? t("activity.enrich") : t("activity.scan");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title={t("topbar.activity")}
        className="relative rounded-lg bg-white/5 p-2 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        <Bell className="h-4 w-4" />
        {jobs.length > 0 && (
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-violet-400" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl bg-[#120e1d] p-2 shadow-xl ring-1 ring-white/10">
            <p className="px-2 py-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {t("activity.title")}
            </p>
            {jobs.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-500">{t("activity.empty")}</p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <span className={statusDot(job.status)} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{kindLabel(job.kind)}</span>{" "}
                      <span className="text-neutral-400">{job.message}</span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-600">
                      {timeAgo(job.finished_at ?? job.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
