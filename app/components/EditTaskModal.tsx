"use client";

import { useState } from "react";
import { Button, Input, Modal, Space, Typography } from "antd";
import { TaskRow } from "../types/task";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import {
  fromLocalDateTimeInputValue,
  toLocalDateTimeInputValue,
} from "../lib/time";
import { friendlySupabaseError } from "../lib/supabaseErrors";
import { toast } from "../lib/toast";
import { colors } from "../styles/colors";

type Props = {
  task: TaskRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: (task: TaskRow) => void;
};

export default function EditTaskModal({ task, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(() => task?.title ?? "");
  const [notes, setNotes] = useState(() => task?.notes ?? "");
  const [startedAt, setStartedAt] = useState(() =>
    toLocalDateTimeInputValue(task?.started_at ?? null),
  );
  const [endedAt, setEndedAt] = useState(() =>
    toLocalDateTimeInputValue(task?.ended_at ?? null),
  );
  const [saving, setSaving] = useState(false);

  if (!open || !task) return null;

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    if (!startedAt || !endedAt) return;

    const startedIso = fromLocalDateTimeInputValue(startedAt);
    const endedIso = fromLocalDateTimeInputValue(endedAt);
    if (!startedIso || !endedIso) return;
    const durationMs = Math.max(
      0,
      new Date(endedIso).getTime() - new Date(startedIso).getTime(),
    );

    setSaving(true);

    const { data, error } = await supabaseBrowser
      .from("tasks")
      .update({
        title: t,
        notes: notes.trim() || null,
        started_at: startedIso,
        ended_at: endedIso,
        duration_ms: Math.floor(durationMs),
        accumulated_ms: Math.floor(durationMs),
      })
      .eq("id", task.id)
      .select("*")
      .single();

    setSaving(false);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return;
    }

    onSaved(data as TaskRow);
    onClose();
  };

  return (
    <Modal
      title="Edit Task"
      open={open && !!task}
      onCancel={onClose}
      footer={
        <Space>
          <Button
            style={{
              backgroundColor: colors.warning,
              borderColor: colors.warning,
              color: colors.slate900,
            }}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="primary"
            style={{
              backgroundColor: colors.success,
              borderColor: colors.success,
            }}
            onClick={save}
            disabled={saving || !title.trim() || !startedAt || !endedAt}
          >
            Save
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text>Title</Typography.Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
          />
        </Space>

        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text>Notes</Typography.Text>
          <Input.TextArea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={saving}
          />
        </Space>

        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text>Started At</Typography.Text>
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            disabled={saving}
          />
        </Space>

        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text>Ended At</Typography.Text>
          <Input
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
            disabled={saving}
          />
        </Space>
      </Space>
    </Modal>
  );
}
