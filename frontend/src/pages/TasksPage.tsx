import { CheckCircle2, ChevronRight, Clock, Loader2, X, XCircle } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { useActivity } from "../ActivityContext";
import { api, type Task, type TaskStatus } from "../api";

function activeIds(tasks: Task[]): number[] {
  return tasks
    .filter((task) => task.status === "pending" || task.status === "running")
    .map((task) => task.id);
}

function CancelButton({ ids }: { ids: number[] }): JSX.Element | null {
  const { t } = useTranslation();
  const { refreshSoon } = useActivity();
  if (ids.length === 0) return null;
  const cancel = (event: MouseEvent): void => {
    event.preventDefault(); // don't toggle the <details> when the ✕ sits in a <summary>
    event.stopPropagation();
    api.cancelTasks(ids).then(refreshSoon).catch(() => undefined);
  };
  return (
    <button
      onClick={cancel}
      title={t("tasks.cancel")}
      className="shrink-0 rounded-md p-1 text-neutral-500 transition hover:bg-white/10 hover:text-red-300"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

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

// Open only groups that are actively in progress; collapse finished and not-yet-started.
function inProgress(tasks: Task[]): boolean {
  const running = tasks.some((task) => task.status === "running");
  const pending = tasks.some((task) => task.status === "pending");
  const done = tasks.some((task) => task.status === "done");
  return running || (done && pending);
}

// Order groups the way the queue will reach them: lowest queued/running id first,
// finished groups (nothing left to run) last.
function queueKey(tasks: Task[]): number {
  const active = tasks
    .filter((task) => task.status === "running" || task.status === "pending")
    .map((task) => task.id);
  return active.length > 0 ? Math.min(...active) : Number.MAX_SAFE_INTEGER;
}

function byQueue(groups: Task[][]): Task[][] {
  return [...groups].sort((a, b) => queueKey(a) - queueKey(b));
}

function fmtEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusDetail(task: Task, t: TFunction): string {
  if (task.status === "running") {
    const parts = [t("tasks.inProgress")];
    if (task.message) parts.push(task.message); // "7/12" for scan/metadata
    if (task.progress > 0) parts.push(`${task.progress}%`);
    if (task.eta_seconds) parts.push(`ETA ${fmtEta(task.eta_seconds)}`);
    return parts.join(" · ");
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
  cancelIds = [],
  children,
}: {
  label: string;
  status: TaskStatus;
  defaultOpen: boolean;
  cancelIds?: number[];
  children: ReactNode;
}): JSX.Element {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500 transition group-open:rotate-90" />
        <StatusIcon status={status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <CancelButton ids={cancelIds} />
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
      <span className="min-w-0 flex-1 truncate text-neutral-300">{label}</span>
      <span className="shrink-0 text-xs text-neutral-500">{statusDetail(task, t)}</span>
      <CancelButton ids={activeIds([task])} />
    </div>
  );
}

function LibraryLeaves({ tasks }: { tasks: Task[] }): JSX.Element {
  // Library-level tasks (SCAN / METADATA): one leaf per library, in queue order.
  const libraries = byQueue(groupBy(tasks, (task) => task.library_id ?? 0));
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

  const seasons = byQueue(groupBy(tasks, (task) => task.season_number ?? 1));
  return (
    <Group label={title} status={status} defaultOpen={inProgress(tasks)} cancelIds={activeIds(tasks)}>
      {seasons.map((seasonTasks) => {
        const episodes = [...seasonTasks].sort(
          (a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0),
        );
        return (
          <Group
            key={seasonTasks[0].season_number ?? 1}
            label={t("tasks.season", { number: seasonTasks[0].season_number ?? 1 })}
            status={aggregate(seasonTasks)}
            defaultOpen={inProgress(seasonTasks)}
            cancelIds={activeIds(seasonTasks)}
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
  const { tasks, refreshSoon } = useActivity();
  const [confirming, setConfirming] = useState(false);

  if (tasks.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("tasks.title")}</h1>
        <p className="mt-2 text-neutral-400">{t("tasks.empty")}</p>
      </div>
    );
  }

  const types = byQueue(groupBy(tasks, (task) => task.type));
  const queuedIds = tasks.filter((task) => task.status === "pending").map((task) => task.id);
  const cancelAllQueued = (): void => {
    api.cancelTasks(queuedIds).then(refreshSoon).catch(() => undefined);
    setConfirming(false);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("tasks.title")}</h1>
        {queuedIds.length > 0 && (
          <button
            onClick={() => (confirming ? cancelAllQueued() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-200"
          >
            {confirming
              ? t("tasks.confirmCancel")
              : t("tasks.cancelAllQueued", { count: queuedIds.length })}
          </button>
        )}
      </div>
      <div className="rounded-2xl bg-white/[0.02] p-2 ring-1 ring-white/10">
        {types.map((typeTasks) => (
          <Group
            key={typeTasks[0].type}
            label={t(`tasks.type_${typeTasks[0].type}`)}
            status={aggregate(typeTasks)}
            defaultOpen={inProgress(typeTasks)}
            cancelIds={activeIds(typeTasks)}
          >
            {typeTasks[0].type === "normalize" ||
            typeTasks[0].type === "intro" ||
            typeTasks[0].type === "prepare_variant" ? (
              byQueue(groupBy(typeTasks, (task) => task.series_id ?? 0)).map((seriesTasks) => (
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
