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

  const runningStartRef = useRef<number>(nowMs()); // when current running slice began
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

    setAccumulatedMs(nextAccum);
    setTotalMs(nextAccum);
    setStatus("paused");
    clearStoredRunningStartMs();

    await persist({
      status: "paused",
      accumulated_ms: Math.floor(nextAccum),
    });
  };

  const resume = async () => {
    if (status !== "paused") return;

    runningStartRef.current = nowMs();
    writeStoredRunningStartMs(task.id, runningStartRef.current);
    setTotalMs(accumulatedMs);
    setStatus("running");

    await persist({
      status: "running",
      // keep accumulated as-is
      accumulated_ms: Math.floor(accumulatedMs),
    });
  };

  const finish = async () => {
    const finalMs =
      status === "running"
        ? accumulatedMs + (nowMs() - runningStartRef.current)
        : accumulatedMs;

    await persist({
      status: "finished",
      ended_at: new Date().toISOString(),
      duration_ms: Math.floor(finalMs),
      accumulated_ms: Math.floor(finalMs),
    });

    setTotalMs(finalMs);
    clearStoredRunningStartMs();
    onFinishedOrCanceled();
  };

  const cancel = async () => {
    // requirement: cancel option
    await persist({
      status: "canceled",
      ended_at: new Date().toISOString(),
      duration_ms: 0,
      accumulated_ms: 0,
    });

    setTotalMs(0);
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
