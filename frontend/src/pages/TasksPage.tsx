import { CheckCircle2, ChevronRight, Clock, Loader2, XCircle } from "lucide-react";
import { type ReactNode } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useActivity } from "../ActivityContext";
import type { Task, TaskStatus } from "../api";

function groupBy<T>(items: T[], key: (item: T) => string | number): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = String(key(item));
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()];
}

function aggregate(tasks: Task[]): TaskStatus {
  if (tasks.some((task) => task.status === "running")) return "running";
  if (tasks.some((task) => task.status === "pending")) return "pending";
  if (tasks.some((task) => task.status === "failed")) return "failed";
  return "done";
}

function fmtEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusDetail(task: Task, t: TFunction): string {
  if (task.status === "running") {
    const eta = task.eta_seconds ? ` · ETA ${fmtEta(task.eta_seconds)}` : "";
    return `${t("tasks.inProgress")} ${task.progress}%${eta}`;
  }
  if (task.status === "done") return t("tasks.done");
  if (task.status === "failed") return task.message ?? t("tasks.failed");
  return t("tasks.queued");
}

function StatusIcon({ status }: { status: TaskStatus }): JSX.Element {
  if (status === "running")
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 shrink-0 text-red-400" />;
  return <Clock className="h-4 w-4 shrink-0 text-neutral-500" />; // pending = queued
}

function Group({
  label,
  status,
  defaultOpen,
  children,
}: {
  label: string;
  status: TaskStatus;
  defaultOpen: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500 transition group-open:rotate-90" />
        <StatusIcon status={status} />
        <span className="truncate text-sm font-medium">{label}</span>
      </summary>
      <div className="ml-[18px] border-l border-white/10 pl-2">{children}</div>
    </details>
  );
}

function Leaf({ label, task }: { label: string; task: Task }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm">
      <StatusIcon status={task.status} />
      <span className="truncate text-neutral-300">{label}</span>
      <span className="ml-auto shrink-0 text-xs text-neutral-500">{statusDetail(task, t)}</span>
    </div>
  );
}

function LibraryLeaves({ tasks }: { tasks: Task[] }): JSX.Element {
  // Library-level tasks (SCAN / METADATA): one leaf per library, newest first.
  const libraries = groupBy(tasks, (task) => task.library_id ?? 0);
  return (
    <>
      {libraries.map((libTasks) => (
        <Leaf
          key={libTasks[0].library_id ?? 0}
          task={libTasks[0]}
          label={libTasks[0].library_name ?? "—"}
        />
      ))}
    </>
  );
}

function SeriesGroup({ tasks }: { tasks: Task[] }): JSX.Element {
  const { t } = useTranslation();
  const status = aggregate(tasks);
  const title = tasks[0].series_title ?? "—";

  // Movies have no season/episode levels: show the film as a single leaf row.
  if (tasks[0].library_kind === "movie") {
    return <Leaf label={title} task={tasks[0]} />;
  }

  const seasons = groupBy(tasks, (task) => task.season_number ?? 1).sort(
    (a, b) => (a[0].season_number ?? 0) - (b[0].season_number ?? 0),
  );
  return (
    <Group label={title} status={status} defaultOpen={status === "running" || status === "pending"}>
      {seasons.map((seasonTasks) => {
        const seasonStatus = aggregate(seasonTasks);
        const episodes = [...seasonTasks].sort(
          (a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0),
        );
        return (
          <Group
            key={seasonTasks[0].season_number ?? 1}
            label={t("tasks.season", { number: seasonTasks[0].season_number ?? 1 })}
            status={seasonStatus}
            defaultOpen={seasonStatus === "running" || seasonStatus === "pending"}
          >
            {episodes.map((task) => (
              <Leaf
                key={task.id}
                task={task}
                label={t("tasks.episode", { number: task.episode_number ?? 0 })}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}

export function TasksPage(): JSX.Element {
  const { t } = useTranslation();
  const { tasks } = useActivity();

  if (tasks.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("tasks.title")}</h1>
        <p className="mt-2 text-neutral-400">{t("tasks.empty")}</p>
      </div>
    );
  }

  const types = groupBy(tasks, (task) => task.type);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("tasks.title")}</h1>
      <div className="rounded-2xl bg-white/[0.02] p-2 ring-1 ring-white/10">
        {types.map((typeTasks) => (
          <Group
            key={typeTasks[0].type}
            label={t(`tasks.type_${typeTasks[0].type}`)}
            status={aggregate(typeTasks)}
            defaultOpen
          >
            {typeTasks[0].type === "normalize" ? (
              groupBy(typeTasks, (task) => task.series_id ?? 0)
                .sort((a, b) => (a[0].series_title ?? "").localeCompare(b[0].series_title ?? ""))
                .map((seriesTasks) => (
                  <SeriesGroup key={seriesTasks[0].series_id ?? 0} tasks={seriesTasks} />
                ))
            ) : (
              <LibraryLeaves tasks={typeTasks} />
            )}
          </Group>
        ))}
      </div>
    </div>
  );
}
