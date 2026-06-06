import { Bell, Loader2 } from "lucide-react";
import { type TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useActivity } from "../ActivityContext";
import type { Task, TaskStatus } from "../api";

function statusDot(status: TaskStatus): string {
  const color =
    status === "failed"
      ? "bg-red-400"
      : status === "running"
        ? "bg-violet-400"
        : status === "pending"
          ? "bg-neutral-500"
          : "bg-emerald-400";
  return `h-2 w-2 shrink-0 rounded-full ${color}`;
}

function taskLabel(task: Task, t: TFunction): string {
  const kind = t(`tasks.type_${task.type}`);
  const subject = task.series_title ?? task.library_name ?? "";
  return subject ? `${kind} — ${subject}` : kind;
}

export function ActivityBell(): JSX.Element {
  const { t } = useTranslation();
  const { tasks, running } = useActivity();
  const [open, setOpen] = useState(false);

  const runningTask = tasks.find((task) => task.status === "running");
  const queued = tasks.filter((task) => task.status === "pending").length;
  const indicator = runningTask
    ? `${taskLabel(runningTask, t)} ${runningTask.progress}%` + (queued > 0 ? ` (+${queued})` : "")
    : t("activity.working");

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
        onClick={() => setOpen((value) => !value)}
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
          <div className="absolute top-full right-0 z-50 mt-2 max-h-[80vh] w-72 overflow-auto rounded-xl bg-[#120e1d] p-2 shadow-xl ring-1 ring-white/10">
            <p className="px-2 py-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {t("activity.title")}
            </p>
            {tasks.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-500">{t("activity.empty")}</p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {tasks.slice(0, 15).map((task) => (
                  <li key={task.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <span className={statusDot(task.status)} />
                    <span className="min-w-0 flex-1 truncate text-neutral-300">
                      {taskLabel(task, t)}
                    </span>
                    {task.status === "running" && (
                      <span className="shrink-0 text-xs text-neutral-500">{task.progress}%</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/tasks"
              onClick={() => setOpen(false)}
              className="mt-1 block rounded-md px-2 py-1.5 text-center text-xs font-medium text-violet-300 transition hover:bg-white/5"
            >
              {t("activity.viewAll")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
