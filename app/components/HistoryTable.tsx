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
  const [dateRange, setDateRange] = useState<RangePickerProps["value"]>(null);
  const cacheRef = useRef<Map<string, { rows: TaskRow[]; total: number }>>(
    new Map(),
  );
  const inFlightRef = useRef<Set<string>>(new Set());
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
      return;
    }
    if (tableUnavailable) {
      setIsLoading(false);
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
        return;
      }

      if (inFlightRef.current.has(cacheKey)) {
        return;
      }

      inFlightRef.current.add(cacheKey);
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
      return;
    }

    setRows((data as TaskRow[]) ?? []);
    setTotal(count ?? 0);
    if (cacheKey) {
      cacheRef.current.set(cacheKey, {
        rows: (data as TaskRow[]) ?? [],
        total: count ?? 0,
      });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey, projectId, userId, rangeKey]);

  const downloadExcel = () => {
    const exportRows = rows.map((r) => ({
      Title: r.title,
      Project: projectName ?? "",
      Notes: r.notes ?? "",
      StartedAt: r.started_at,
      EndedAt: r.ended_at ?? "",
      Duration: formatDuration(r.duration_ms),
      DurationMs: r.duration_ms,
      Status: formatStatusLabel(r.status),
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");

    XLSX.writeFile(wb, `task-history-page-${page + 1}.xlsx`);
  };

  const deleteTask = async (task: TaskRow) => {
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
              setDeleteTarget(record);
              setDeleteModalOpen(true);
            },
          })}
        />
      </div>

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
