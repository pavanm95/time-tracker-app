"use client";

import { useState } from "react";
import { Button, Col, Input, Row, Space, Typography } from "antd";
import { TaskRow } from "../types/task";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import { friendlySupabaseError } from "../lib/supabaseErrors";
import { toast } from "../lib/toast";

export default function TaskComposer({
  onCreated,
  disabled,
  projectId,
  userId,
}: {
  onCreated: (task: TaskRow) => void;
  disabled: boolean;
  projectId: string | null;
  userId: string;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const createTask = async () => {
    const t = title.trim();
    if (!t || !projectId) return;

    setIsSaving(true);
    const { data, error } = await supabaseBrowser
      .from("tasks")
      .insert({
        project_id: projectId,
        user_id: userId,
        title: t,
        notes: notes.trim() || null,
        status: "running",
        started_at: new Date().toISOString(),
        accumulated_ms: 0,
        duration_ms: 0,
      })
      .select("*")
      .single();

    setIsSaving(false);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return;
    }

    setTitle("");
    setNotes("");
    onCreated(data as TaskRow);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col span={12}>
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Typography.Text>Task</Typography.Text>
            <Input
              placeholder="e.g., Implement history pagination"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled || isSaving}
            />
          </Space>
        </Col>
        <Col span={12}>
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Typography.Text>Notes</Typography.Text>
            <Input
              placeholder="Optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={disabled || isSaving}
            />
          </Space>
        </Col>
      </Row>

      <Button
        type="primary"
        style={{
          backgroundColor: "#D73535",
          borderColor: "#D73535",
          color: "#fff",
        }}
        onClick={createTask}
        disabled={disabled || isSaving || !title.trim() || !projectId}
      >
        Start Task
      </Button>

      {disabled ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Finish or cancel the active task before starting a new one.
        </Typography.Text>
      ) : !projectId ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Create and select a project to start tracking tasks.
        </Typography.Text>
      ) : null}
    </Space>
  );
}
