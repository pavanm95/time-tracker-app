export type TaskStatus = "running" | "paused" | "finished" | "canceled";

export type TaskRow = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  started_at: string;
  ended_at: string | null;
  accumulated_ms: number;
  duration_ms: number;
  pause_count?: number | null;
  paused_ms?: number | null;
  paused_at?: string | null;
  created_at: string;
  updated_at: string;
};
