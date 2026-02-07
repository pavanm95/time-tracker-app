"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { TaskRow } from "../types/task";
import { formatDuration, nowMs } from "../lib/time";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import { friendlySupabaseError } from "../lib/supabaseErrors";
import { toast } from "../lib/toast";
import { colors } from "../styles/colors";

type Status = "running" | "paused";

const formatStatusLabel = (value: Status) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const parseIsoMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const getRunningStartMs = (task: TaskRow) => {
  const updatedAtMs = parseIsoMs(task.updated_at);
  const startedAtMs = parseIsoMs(task.started_at);
  return updatedAtMs ?? startedAtMs ?? nowMs();
};

const getPausedAtMs = (task: TaskRow) => {
  const pausedAtMs = parseIsoMs(task.paused_at);
  const updatedAtMs = parseIsoMs(task.updated_at);
  const startedAtMs = parseIsoMs(task.started_at);
  return pausedAtMs ?? updatedAtMs ?? startedAtMs ?? nowMs();
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
    const nextStatus = task.status as Status;
    const nextAccumulated = task.accumulated_ms || 0;
    const nextPauseCount = task.pause_count ?? 0;
    const nextPausedMs = task.paused_ms ?? 0;

    setStatus(nextStatus);
    setAccumulatedMs(nextAccumulated);
    setPauseCount(nextPauseCount);
    setPausedMs(nextPausedMs);

    if (nextStatus === "running") {
      runningStartRef.current = getRunningStartMs(task);
      pausedAtRef.current = null;
      setTotalMs(nextAccumulated + (nowMs() - runningStartRef.current));
      return;
    }

    if (nextStatus === "paused") {
      pausedAtRef.current = getPausedAtMs(task);
    } else {
      pausedAtRef.current = null;
    }

    setTotalMs(nextAccumulated);
  }, [
    task.id,
    task.status,
    task.accumulated_ms,
    task.pause_count,
    task.paused_ms,
    task.paused_at,
    task.updated_at,
    task.started_at,
  ]);

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
    onFinishedOrCanceled();
  };

  return (
    <Card type="inner">
      <div className="active-stopwatch__row">
        <div>
          <Typography.Text type="secondary">Active Task</Typography.Text>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {task.title}
          </Typography.Title>
          {task.notes ? (
            <Typography.Text type="secondary">{task.notes}</Typography.Text>
          ) : null}
        </div>

        <div className="active-stopwatch__meta">
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

      <Space
        size="middle"
        wrap
        style={{ marginTop: 16 }}
        className="active-stopwatch__actions"
      >
        {status === "running" ? (
          <Button
            type="primary"
            style={{
              backgroundColor: colors.danger,
              borderColor: colors.danger,
            }}
            onClick={pause}
          >
            Pause
          </Button>
        ) : (
          <Button
            type="primary"
            style={{
              backgroundColor: colors.danger,
              borderColor: colors.danger,
            }}
            onClick={resume}
            icon={<PlayCircleOutlined />}
            className="active-stopwatch__action active-stopwatch__action--resume"
            aria-label="Resume"
          >
            <span className="active-stopwatch__label">Resume</span>
          </Button>
        )}

        <Button
          style={{
            backgroundColor: colors.warning,
            borderColor: colors.warning,
            color: colors.slate900,
          }}
          onClick={cancel}
          icon={<CloseCircleOutlined />}
          className="active-stopwatch__action active-stopwatch__action--cancel"
          aria-label="Cancel"
        >
          <span className="active-stopwatch__label">Cancel</span>
        </Button>

        <Button
          type="primary"
          style={{
            backgroundColor: colors.success,
            borderColor: colors.success,
          }}
          onClick={finish}
          icon={<CheckCircleOutlined />}
          className="active-stopwatch__action active-stopwatch__action--finish"
          aria-label="Finish"
        >
          <span className="active-stopwatch__label">Finish</span>
        </Button>
      </Space>
    </Card>
  );
}
