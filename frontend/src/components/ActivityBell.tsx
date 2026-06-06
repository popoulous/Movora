import { Bell, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useActivity } from "../ActivityContext";

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
  const { jobs, tasks, running } = useActivity();
  const [open, setOpen] = useState(false);

  const kindLabel = (kind: string): string =>
    kind === "enrich"
      ? t("activity.enrich")
      : kind === "normalize"
        ? t("activity.normalize")
        : t("activity.scan");

  const runningTask = tasks.find((task) => task.status === "running");
  const queued = tasks.filter((task) => task.status === "pending").length;
  const runningJob = jobs.find((job) => job.status === "running");

  const indicator = runningTask
    ? `${t("activity.normalize")} — ${runningTask.series_title ?? ""} ${runningTask.progress}%` +
      (queued > 0 ? ` (+${queued})` : "")
    : runningJob
      ? `${kindLabel(runningJob.kind)} — ${runningJob.message}`
      : t("activity.working");

  const toggle = (): void => setOpen((value) => !value);

  return (
    <div className="relative flex items-center gap-2">
      {/* Always-visible progress indicator -> the full Tasks tree, no panel needed. */}
      {running && (
        <Link
          to="/tasks"
          className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
          <span className="max-w-[220px] truncate">{indicator}</span>
        </Link>
      )}

      <button
        onClick={toggle}
        title={t("topbar.activity")}
        className="relative rounded-lg bg-white/5 p-2 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        <Bell className="h-4 w-4" />
        {running && (
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
                  <li key={job.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
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
