"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadOutlined,
  EditOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import {
  Button,
  DatePicker,
  Descriptions,
  Modal,
  Pagination,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { RangePickerProps } from "antd/es/date-picker";
import type { ColumnsType } from "antd/es/table";
import * as XLSX from "xlsx";
import { TaskRow } from "../types/task";
import { supabaseBrowser } from "../lib/supabaseBrowser";
import {
  friendlySupabaseError,
  isMissingTableError,
} from "../lib/supabaseErrors";
import { formatDateTimeYmdHms, formatDuration } from "../lib/time";
import { toast } from "../lib/toast";
import EditTaskModal from "./EditTaskModal";

const PAGE_SIZE = 20;
const { RangePicker } = DatePicker;

export default function HistoryTable({
  refreshKey,
  projectId,
  projectName,
  userId,
}: {
  refreshKey: number;
  projectId: string | null;
  projectName: string | null;
  userId: string;
}) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [viewTask, setViewTask] = useState<TaskRow | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    task: TaskRow;
    x: number;
    y: number;
  } | null>(null);
  const [dateRange, setDateRange] = useState<RangePickerProps["value"]>(null);
  const cacheRef = useRef<Map<string, { rows: TaskRow[]; total: number }>>(
    new Map(),
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  const activeRequestRef = useRef<string | null>(null);
  const [tableUnavailable, setTableUnavailable] = useState(false);

  const statusTagColors: Record<TaskRow["status"], string> = {
    running: "#D73535",
    finished: "#007E6E",
    canceled: "#FFA239",
    paused: "#e2e8f0",
  };
  const statusTextColors: Record<TaskRow["status"], string> = {
    running: "#ffffff",
    finished: "#ffffff",
    canceled: "#0f172a",
    paused: "#475569",
  };
  const formatStatusLabel = (value: TaskRow["status"]) =>
    value.charAt(0).toUpperCase() + value.slice(1);
  const getPauseCount = (task: TaskRow) => Math.max(0, task.pause_count ?? 0);
  const getPausedMs = (task: TaskRow) => {
    const baseMs = Math.max(0, task.paused_ms ?? 0);
    if (task.status !== "paused") return baseMs;
    const pausedAt = task.paused_at ?? task.updated_at ?? task.started_at;
    const pausedAtMs = pausedAt ? new Date(pausedAt).getTime() : NaN;
    if (Number.isNaN(pausedAtMs)) return baseMs;
    return Math.max(0, baseMs + (Date.now() - pausedAtMs));
  };
  const getDisplayDurationMs = (task: TaskRow) =>
    ["finished", "canceled"].includes(task.status)
      ? task.duration_ms
      : task.accumulated_ms;
  const canDeleteTask = (task: TaskRow) =>
    ["finished", "canceled"].includes(task.status);
  const rangeKey = useMemo(() => {
    if (!dateRange) return "all";
    return dateRange
      .map((value) => (value ? value.format("YYYY-MM-DD") : ""))
      .join(":");
  }, [dateRange]);

  const getCacheKey = () => {
    if (!projectId) return null;
    return `${userId}:${projectId}:${page}:${refreshKey}:${rangeKey}`;
  };

  const load = async () => {
    if (!projectId) {
      setIsLoading(false);
      setRows([]);
      setTotal(0);
      activeRequestRef.current = null;
      return;
    }
    if (tableUnavailable) {
      setIsLoading(false);
      activeRequestRef.current = null;
      return;
    }

    // Supabase supports count via select(..., { count: 'exact' })
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const cacheKey = getCacheKey();

    if (cacheKey) {
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setIsLoading(false);
        setRows(cached.rows);
        setTotal(cached.total);
        activeRequestRef.current = null;
        return;
      }

      if (inFlightRef.current.has(cacheKey)) {
        return;
      }

      inFlightRef.current.add(cacheKey);
      activeRequestRef.current = cacheKey;
    }

    setIsLoading(true);

    const startDate = dateRange?.[0]?.startOf("day") ?? null;
    const endDate = dateRange?.[1]?.endOf("day") ?? null;

    let query = supabaseBrowser
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("project_id", projectId)
      .eq("user_id", userId);

    if (startDate) {
      query = query.gte("started_at", startDate.toISOString());
    }
    if (endDate) {
      query = query.lte("started_at", endDate.toISOString());
    }

    const { data, count, error } = await query
      .order("ended_at", { ascending: false })
      .range(from, to);

    if (cacheKey && activeRequestRef.current !== cacheKey) {
      inFlightRef.current.delete(cacheKey);
      return;
    }

    setIsLoading(false);
    if (cacheKey) {
      inFlightRef.current.delete(cacheKey);
    }

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      if (isMissingTableError(error.message)) {
        setTableUnavailable(true);
        setRows([]);
        setTotal(0);
      }
      if (cacheKey && activeRequestRef.current === cacheKey) {
        activeRequestRef.current = null;
      }
      return;
    }

    setRows((data as TaskRow[]) ?? []);
    setTotal(count ?? 0);
    if (cacheKey) {
      cacheRef.current.set(cacheKey, {
        rows: (data as TaskRow[]) ?? [],
        total: count ?? 0,
      });
      if (activeRequestRef.current === cacheKey) {
        activeRequestRef.current = null;
      }
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey, projectId, userId, rangeKey]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.button !== 2) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    const handleScroll = () => setContextMenu(null);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleScroll);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  const downloadExcel = () => {
    const exportRows = rows.map((r) => ({
      Title: r.title,
      Project: projectName ?? "",
      Notes: r.notes ?? "",
      StartedAt: r.started_at,
      EndedAt: r.ended_at ?? "",
      Duration: formatDuration(r.duration_ms),
      DurationMs: r.duration_ms,
      PauseCount: getPauseCount(r),
      Paused: formatDuration(getPausedMs(r)),
      PausedMs: getPausedMs(r),
      Status: formatStatusLabel(r.status),
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");

    XLSX.writeFile(wb, `task-history-page-${page + 1}.xlsx`);
  };

  const deleteTask = async (task: TaskRow) => {
    if (!canDeleteTask(task)) {
      toast.error("Only finished or canceled tasks can be deleted.");
      return;
    }
    const { error } = await supabaseBrowser
      .from("tasks")
      .delete()
      .eq("id", task.id);

    if (error) {
      toast.error(friendlySupabaseError(error.message));
      return;
    }

    if (editingTask?.id === task.id) {
      setModalOpen(false);
      setEditingTask(null);
    }
    if (deleteTarget?.id === task.id) {
      setDeleteModalOpen(false);
      setDeleteTarget(null);
    }

    toast.success("Task deleted.");

    const nextTotal = Math.max(0, total - 1);
    const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
    const nextPage = Math.min(page, nextTotalPages - 1);
    setTotal(nextTotal);
    if (nextPage !== page) {
      setPage(nextPage);
      return;
    }

    setRows((prev) => {
      const nextRows = prev.filter((row) => row.id !== task.id);
      const cacheKey = getCacheKey();
      if (cacheKey) {
        cacheRef.current.set(cacheKey, { rows: nextRows, total: nextTotal });
      }
      return nextRows;
    });
  };

  const columns: ColumnsType<TaskRow> = [
    {
      title: "Task",
      dataIndex: "title",
      key: "title",
      render: (_, record) => (
        <div>
          <Typography.Text strong>{record.title}</Typography.Text>
          {record.notes ? (
            <div>
              <Typography.Text type="secondary">{record.notes}</Typography.Text>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "Started",
      dataIndex: "started_at",
      key: "started_at",
      width: 190,
      render: (value: string) => formatDateTimeYmdHms(value),
    },
    {
      title: "Ended",
      dataIndex: "ended_at",
      key: "ended_at",
      width: 190,
      render: (value: string | null) => formatDateTimeYmdHms(value),
    },
    {
      title: "Duration",
      dataIndex: "duration_ms",
      key: "duration_ms",
      width: 140,
      render: (value: number) => (
        <span style={{ fontFamily: "var(--font-geist-mono)" }}>
          {formatDuration(value)}
        </span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (value: TaskRow["status"]) => (
        <Tag
          color={statusTagColors[value]}
          style={{
            color: statusTextColors[value],
            border: "none",
            borderRadius: 999,
          }}
        >
          {formatStatusLabel(value)}
        </Tag>
      ),
    },
    {
      title: "Action",
      key: "edit",
      width: 60,
      render: (_, record) =>
        record.status === "running" ? (
          <Button
            type="text"
            icon={<LoadingOutlined spin />}
            aria-label="Running"
            title="Running"
            disabled
          />
        ) : (
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingTask(record);
              setModalOpen(true);
            }}
            aria-label="Edit"
            title="Edit"
          />
        ),
    },
  ];

  const getContextMenuPosition = (x: number, y: number) => {
    const menuWidth = 180;
    const menuHeight = 84;
    const padding = 8;
    const maxX = window.innerWidth - menuWidth - padding;
    const maxY = window.innerHeight - menuHeight - padding;
    return {
      x: Math.max(padding, Math.min(x, maxX)),
      y: Math.max(padding, Math.min(y, maxY)),
    };
  };

  const openView = (task: TaskRow) => {
    setViewTask(task);
    setContextMenu(null);
  };

  const openDelete = (task: TaskRow) => {
    if (!canDeleteTask(task)) return;
    setDeleteTarget(task);
    setDeleteModalOpen(true);
    setContextMenu(null);
  };

  return (
    <div className="history-table">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Typography.Title level={5} style={{ marginBottom: 0 }}>
            Task List{projectName ? ` - ${projectName}` : ""}
          </Typography.Title>
          <Typography.Text type="secondary">
            Showing {rows.length} of {total} tasks (page size {PAGE_SIZE}).
          </Typography.Text>
        </div>

        <Space size="middle" wrap>
          <Button
            icon={<DownloadOutlined />}
            onClick={downloadExcel}
            disabled={rows.length === 0}
          >
            Download Excel
          </Button>
          <RangePicker
            value={dateRange}
            onChange={(value) => {
              setDateRange(value);
              setPage(0);
            }}
            allowClear
            format="YYYY-MM-DD"
            placeholder={["Start date", "End date"]}
          />
          <Pagination
            current={page + 1}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={(nextPage) => setPage(nextPage - 1)}
          />
        </Space>
      </div>

      <div className="history-table__table">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={isLoading}
          pagination={false}
          size="middle"
          scroll={{ x: "max-content", y: "var(--history-table-body-height)" }}
          sticky
          locale={{ emptyText: "No history yet." }}
          onRow={(record) => ({
            onContextMenu: (event) => {
              event.preventDefault();
              const position = getContextMenuPosition(
                event.clientX,
                event.clientY,
              );
              setContextMenu({ task: record, ...position });
            },
          })}
        />
      </div>

      {contextMenu ? (
        <div
          role="menu"
          aria-label="Task actions"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            background: "#ffffff",
            borderRadius: 8,
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.16)",
            padding: 4,
            minWidth: 160,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            type="text"
            style={{ width: "100%", textAlign: "left" }}
            onClick={() => openView(contextMenu.task)}
          >
            View
          </Button>
          <Button
            type="text"
            danger
            style={{ width: "100%", textAlign: "left" }}
            disabled={!canDeleteTask(contextMenu.task)}
            onClick={() => openDelete(contextMenu.task)}
          >
            Delete
          </Button>
        </div>
      ) : null}

      <EditTaskModal
        key={editingTask?.id ?? "none"}
        task={editingTask}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
        onSaved={(updated) => {
          setRows((prev) =>
            prev.map((r) => (r.id === updated.id ? updated : r)),
          );
        }}
      />

      <Modal
        title="Task Details"
        open={!!viewTask}
        onCancel={() => setViewTask(null)}
        footer={
          <Button
            type="primary"
            style={{ backgroundColor: "#007E6E", borderColor: "#007E6E" }}
            onClick={() => setViewTask(null)}
          >
            Close
          </Button>
        }
      >
        {viewTask ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Title">
              {viewTask.title}
            </Descriptions.Item>
            <Descriptions.Item label="Notes">
              {viewTask.notes ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag
                color={statusTagColors[viewTask.status]}
                style={{
                  color: statusTextColors[viewTask.status],
                  border: "none",
                  borderRadius: 999,
                }}
              >
                {formatStatusLabel(viewTask.status)}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Started">
              {formatDateTimeYmdHms(viewTask.started_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Ended">
              {formatDateTimeYmdHms(viewTask.ended_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Duration">
              <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                {formatDuration(getDisplayDurationMs(viewTask))}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="Pause Count">
              {getPauseCount(viewTask)}
            </Descriptions.Item>
            <Descriptions.Item label="Paused Time">
              <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                {formatDuration(getPausedMs(viewTask))}
              </span>
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <Modal
        title="Delete Task"
        open={deleteModalOpen && !!deleteTarget}
        onCancel={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        onOk={async () => {
          if (!deleteTarget) return;
          await deleteTask(deleteTarget);
        }}
        okText="Delete"
        cancelText="Cancel"
        okButtonProps={{
          style: { backgroundColor: "#D73535", borderColor: "#D73535" },
        }}
        cancelButtonProps={{
          style: {
            backgroundColor: "#FFA239",
            borderColor: "#FFA239",
            color: "#0f172a",
          },
        }}
      >
        <Typography.Text>
          Delete `{deleteTarget?.title}`? This cannot be undone.
        </Typography.Text>
      </Modal>
    </div>
  );
}
