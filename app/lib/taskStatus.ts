import { TaskRow } from "../types/task";

export const formatStatusLabel = (value: TaskRow["status"]) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const getPauseCount = (task: TaskRow) =>
  Math.max(0, task.pause_count ?? 0);

export const getPausedMs = (task: TaskRow) => {
  const baseMs = Math.max(0, task.paused_ms ?? 0);
  if (task.status !== "paused") return baseMs;
  const pausedAt = task.paused_at ?? task.updated_at ?? task.started_at;
  const pausedAtMs = pausedAt ? new Date(pausedAt).getTime() : NaN;
  if (Number.isNaN(pausedAtMs)) return baseMs;
  return Math.max(0, baseMs + (Date.now() - pausedAtMs));
};

export const getDisplayDurationMs = (task: TaskRow) =>
  ["finished", "canceled"].includes(task.status)
    ? task.duration_ms
    : task.accumulated_ms;

export const canDeleteTask = (task: TaskRow) =>
  ["finished", "canceled"].includes(task.status);
