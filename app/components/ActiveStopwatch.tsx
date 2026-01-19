"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Space, Typography } from "antd";
import { TaskRow } from "../types/task";
import { formatDuration, nowMs } from "../lib/time";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import { friendlySupabaseError } from "../lib/supabaseErrors";
import { ACTIVE_TASK_RUNNING_START_KEY } from "../lib/storageKeys";
import { toast } from "../lib/toast";

type Status = "running" | "paused";

const formatStatusLabel = (value: Status) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const readStoredRunningStartMs = (taskId: string) => {
  const raw = localStorage.getItem(ACTIVE_TASK_RUNNING_START_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      taskId?: string;
      runningStartMs?: number;
    };
    if (parsed?.taskId !== taskId) return null;
    if (typeof parsed.runningStartMs !== "number") return null;
    return parsed.runningStartMs;
  } catch {
    return null;
  }
};

const writeStoredRunningStartMs = (taskId: string, startMs: number) => {
  localStorage.setItem(
    ACTIVE_TASK_RUNNING_START_KEY,
    JSON.stringify({
      taskId,
      runningStartMs: Math.floor(startMs),
    }),
  );
};

const clearStoredRunningStartMs = () => {
  localStorage.removeItem(ACTIVE_TASK_RUNNING_START_KEY);
};

const parseIsoMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

export default function ActiveStopwatch({
  task,
  onUpdated,
  onFinishedOrCanceled,
}: {
  task: TaskRow;
  onUpdated: (task: TaskRow) => void;
  onFinishedOrCanceled: () => void;
}) {
  const [status, setStatus] = useState<Status>(task.status as Status);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(
    task.accumulated_ms || 0,
  );
  const [totalMs, setTotalMs] = useState<number>(task.accumulated_ms || 0);
  const [pauseCount, setPauseCount] = useState<number>(task.pause_count ?? 0);
  const [pausedMs, setPausedMs] = useState<number>(task.paused_ms ?? 0);

  const runningStartRef = useRef<number>(nowMs()); // when current running slice began
  const pausedAtRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "running") {
      clearStoredRunningStartMs();
      return;
    }

    const storedStart = readStoredRunningStartMs(task.id);
    if (storedStart !== null) {
      runningStartRef.current = storedStart;
    } else {
      const updatedAtMs = new Date(task.updated_at).getTime();
      const startedAtMs = new Date(task.started_at).getTime();
      const fallbackMs = Number.isNaN(updatedAtMs) ? startedAtMs : updatedAtMs;
      runningStartRef.current = Number.isNaN(fallbackMs) ? nowMs() : fallbackMs;
    }

    writeStoredRunningStartMs(task.id, runningStartRef.current);
  }, [status, task.id, task.updated_at, task.started_at]);

  useEffect(() => {
    if (status !== "paused") {
      pausedAtRef.current = null;
      return;
    }
    if (pausedAtRef.current !== null) return;
    const pausedAtMs =
      parseIsoMs(task.paused_at) ??
      parseIsoMs(task.updated_at) ??
      parseIsoMs(task.started_at);
    pausedAtRef.current = pausedAtMs ?? nowMs();
  }, [status, task.paused_at, task.updated_at, task.started_at]);

  // ticking
  useEffect(() => {
    if (status !== "running") return;

    tickRef.current = window.setInterval(() => {
      setTotalMs(accumulatedMs + (nowMs() - runningStartRef.current));
    }, 250);

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [status, accumulatedMs]);

  // Keep server in sync on transitions (pause/resume/finish/cancel)
  const persist = async (patch: Partial<TaskRow>) => {
    const { data, error } = await supabaseBrowser
      .from("tasks")
      .update(patch)
      .eq("id", task.id)
      .select("*")
      .single();

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return null;
    }

    onUpdated(data as TaskRow);
    return data as TaskRow;
  };

  const pause = async () => {
    if (status !== "running") return;

    const sliceMs = nowMs() - runningStartRef.current;
    const nextAccum = accumulatedMs + sliceMs;
    const nextPauseCount = pauseCount + 1;
    const pauseStartedMs = nowMs();

    setAccumulatedMs(nextAccum);
    setTotalMs(nextAccum);
    setStatus("paused");
    setPauseCount(nextPauseCount);
    pausedAtRef.current = pauseStartedMs;
    clearStoredRunningStartMs();

    await persist({
      status: "paused",
      accumulated_ms: Math.floor(nextAccum),
      pause_count: nextPauseCount,
      paused_ms: Math.floor(pausedMs),
      paused_at: new Date(pauseStartedMs).toISOString(),
    });
  };

  const resume = async () => {
    if (status !== "paused") return;

    const pauseSliceMs =
      pausedAtRef.current !== null ? nowMs() - pausedAtRef.current : 0;
    const nextPausedMs = pausedMs + pauseSliceMs;

    runningStartRef.current = nowMs();
    writeStoredRunningStartMs(task.id, runningStartRef.current);
    setTotalMs(accumulatedMs);
    setStatus("running");
    setPausedMs(nextPausedMs);
    pausedAtRef.current = null;

    await persist({
      status: "running",
      // keep accumulated as-is
      accumulated_ms: Math.floor(accumulatedMs),
      paused_ms: Math.floor(nextPausedMs),
      paused_at: null,
    });
  };

  const finish = async () => {
    const now = nowMs();
    const finalMs =
      status === "running"
        ? accumulatedMs + (now - runningStartRef.current)
        : accumulatedMs;
    const pauseSliceMs =
      status === "paused" && pausedAtRef.current !== null
        ? now - pausedAtRef.current
        : 0;
    const finalPausedMs = pausedMs + pauseSliceMs;

    await persist({
      status: "finished",
      ended_at: new Date().toISOString(),
      duration_ms: Math.floor(finalMs),
      accumulated_ms: Math.floor(finalMs),
      paused_ms: Math.floor(finalPausedMs),
      paused_at: null,
    });

    setTotalMs(finalMs);
    setPausedMs(finalPausedMs);
    clearStoredRunningStartMs();
    onFinishedOrCanceled();
  };

  const cancel = async () => {
    // requirement: cancel option
    const now = nowMs();
    const pauseSliceMs =
      status === "paused" && pausedAtRef.current !== null
        ? now - pausedAtRef.current
        : 0;
    const finalPausedMs = pausedMs + pauseSliceMs;
    await persist({
      status: "canceled",
      ended_at: new Date().toISOString(),
      duration_ms: 0,
      accumulated_ms: 0,
      paused_ms: Math.floor(finalPausedMs),
      paused_at: null,
    });

    setTotalMs(0);
    setPausedMs(finalPausedMs);
    clearStoredRunningStartMs();
    onFinishedOrCanceled();
  };

  return (
    <Card type="inner">
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
      >
        <div>
          <Typography.Text type="secondary">Active Task</Typography.Text>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {task.title}
          </Typography.Title>
          {task.notes ? (
            <Typography.Text type="secondary">{task.notes}</Typography.Text>
          ) : null}
        </div>

        <div style={{ textAlign: "right" }}>
          <Typography.Text type="secondary">Elapsed</Typography.Text>
          <Typography.Title
            level={3}
            style={{ margin: 0, fontFamily: "var(--font-geist-mono)" }}
          >
            {formatDuration(totalMs)}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Status: {formatStatusLabel(status)}
          </Typography.Text>
        </div>
      </div>

      <Space size="middle" wrap style={{ marginTop: 16 }}>
        {status === "running" ? (
          <Button
            type="primary"
            style={{ backgroundColor: "#D73535", borderColor: "#D73535" }}
            onClick={pause}
          >
            Pause
          </Button>
        ) : (
          <Button
            type="primary"
            style={{ backgroundColor: "#D73535", borderColor: "#D73535" }}
            onClick={resume}
          >
            Resume
          </Button>
        )}

        <Button
          type="primary"
          style={{ backgroundColor: "#007E6E", borderColor: "#007E6E" }}
          onClick={finish}
        >
          Finish
        </Button>

        <Button
          style={{
            backgroundColor: "#FFA239",
            borderColor: "#FFA239",
            color: "#0f172a",
          }}
          onClick={cancel}
        >
          Cancel
        </Button>
      </Space>
    </Card>
  );
}
