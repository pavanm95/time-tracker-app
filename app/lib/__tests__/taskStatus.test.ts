import { describe, expect, it, vi } from "vitest";
import {
  canDeleteTask,
  formatStatusLabel,
  getDisplayDurationMs,
  getPauseCount,
  getPausedMs,
} from "../taskStatus";
import { TaskRow } from "../../types/task";

describe("taskStatus helpers", () => {
  it("formats status labels", () => {
    expect(formatStatusLabel("running")).toBe("Running");
    expect(formatStatusLabel("finished")).toBe("Finished");
  });

  it("guards pause count", () => {
    const task = { pause_count: null } as TaskRow;
    expect(getPauseCount(task)).toBe(0);
  });

  it("computes paused duration for paused tasks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:10:00.000Z"));

    const task = {
      status: "paused",
      paused_ms: 1000,
      paused_at: "2024-01-01T00:00:00.000Z",
    } as TaskRow;

    expect(getPausedMs(task)).toBe(1000 + 10 * 60 * 1000);

    vi.useRealTimers();
  });

  it("returns display duration based on status", () => {
    const running = {
      status: "running",
      accumulated_ms: 1234,
      duration_ms: 9999,
    } as TaskRow;
    const finished = {
      status: "finished",
      accumulated_ms: 1234,
      duration_ms: 9999,
    } as TaskRow;

    expect(getDisplayDurationMs(running)).toBe(1234);
    expect(getDisplayDurationMs(finished)).toBe(9999);
  });

  it("allows delete only for finished/canceled", () => {
    expect(canDeleteTask({ status: "finished" } as TaskRow)).toBe(true);
    expect(canDeleteTask({ status: "canceled" } as TaskRow)).toBe(true);
    expect(canDeleteTask({ status: "paused" } as TaskRow)).toBe(false);
    expect(canDeleteTask({ status: "running" } as TaskRow)).toBe(false);
  });
});
