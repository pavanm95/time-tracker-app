"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  MoreOutlined,
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
import { colors } from "../styles/colors";
import {
  canDeleteTask,
  formatStatusLabel,
  getDisplayDurationMs,
  getPauseCount,
  getPausedMs,
} from "../lib/taskStatus";

const PAGE_SIZE = 10;
const RANGE_DURATION_PAGE_SIZE = 1000;
const { RangePicker } = DatePicker;

export default function HistoryTable({
  refreshKey,
  projectId,
  projectName,
  userId,
  userDisplayName,
  isMobileView = false,
}: {
  refreshKey: number;
  projectId: string | null;
  projectName: string | null;
  userId: string;
  userDisplayName: string;
  isMobileView?: boolean;
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
  const [swipedRowId, setSwipedRowId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<RangePickerProps["value"]>(null);
  const cacheRef = useRef<Map<string, { rows: TaskRow[]; total: number }>>(
    new Map(),
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  const activeRequestRef = useRef<string | null>(null);
  const [tableUnavailable, setTableUnavailable] = useState(false);
  const [rangeDurationMs, setRangeDurationMs] = useState<number | null>(null);
  const [isRangeDurationLoading, setIsRangeDurationLoading] = useState(false);
  const rangeDurationRequestRef = useRef(0);
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const swipeStateRef = useRef<{
    rowId: string | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    pointerId: number | null;
    pointerType: string | null;
  }>({
    rowId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    pointerId: null,
    pointerType: null,
  });

  const statusTagColors: Record<TaskRow["status"], string> = {
    running: colors.status.running,
    finished: colors.status.finished,
    canceled: colors.status.canceled,
    paused: colors.status.paused,
  };
  const statusTextColors: Record<TaskRow["status"], string> = {
    running: colors.statusText.running,
    finished: colors.statusText.finished,
    canceled: colors.statusText.canceled,
    paused: colors.statusText.paused,
  };
  const getCssVarValue = (name: string) => {
    if (typeof window === "undefined") return "";
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  };
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
    if (!projectId || !dateRange || tableUnavailable) {
      setRangeDurationMs(null);
      setIsRangeDurationLoading(false);
      return;
    }

    const requestId = (rangeDurationRequestRef.current += 1);
    const startDate = dateRange?.[0]?.startOf("day") ?? null;
    const endDate = dateRange?.[1]?.endOf("day") ?? null;

    const loadRangeDuration = async () => {
      setIsRangeDurationLoading(true);
      let totalDurationMs = 0;
      let offset = 0;

      while (true) {
        let query = supabaseBrowser
          .from("tasks")
          .select("duration_ms")
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .range(offset, offset + RANGE_DURATION_PAGE_SIZE - 1);

        if (startDate) {
          query = query.gte("started_at", startDate.toISOString());
        }
        if (endDate) {
          query = query.lte("started_at", endDate.toISOString());
        }

        const { data, error } = await query;

        if (rangeDurationRequestRef.current !== requestId) return;

        if (error) {
          toast.error(friendlySupabaseError(error.message));
          setRangeDurationMs(null);
          setIsRangeDurationLoading(false);
          return;
        }

        const chunk = (data as Pick<TaskRow, "duration_ms">[]) ?? [];
        for (const row of chunk) {
          totalDurationMs += Math.max(0, row.duration_ms ?? 0);
        }

        if (chunk.length < RANGE_DURATION_PAGE_SIZE) break;
        offset += RANGE_DURATION_PAGE_SIZE;
      }

      if (rangeDurationRequestRef.current !== requestId) return;
      setRangeDurationMs(totalDurationMs);
      setIsRangeDurationLoading(false);
    };

    loadRangeDuration();
  }, [projectId, userId, refreshKey, dateRange, tableUnavailable]);

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
    const handleScroll = () => {
      setContextMenu(null);
      setSwipedRowId(null);
    };
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

  useEffect(() => {
    if (!swipedRowId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwipedRowId(null);
    };
    const handleResize = () => setSwipedRowId(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [swipedRowId]);

  const downloadExcel = () => {
    const exportColumns = [
      "Title",
      "Notes",
      "StartedAt",
      "EndedAt",
      "Duration",
      "IsPaused",
      "Status",
    ];

    const exportRows = rows.map((r) => [
      r.title,
      r.notes ?? "",
      formatDateTimeYmdHms(r.started_at),
      formatDateTimeYmdHms(r.ended_at),
      formatDuration(r.duration_ms),
      getPauseCount(r) > 0 ? "Yes" : "No",
      formatStatusLabel(r.status),
    ]);

    const totalDurationMs = rows.reduce(
      (sum, row) => sum + Math.max(0, row.duration_ms ?? 0),
      0,
    );
    const totalRow = [
      "Total Duration",
      "",
      "",
      "",
      formatDuration(totalDurationMs),
      "",
    ];

    const downloadDate = (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    })();

    const rangeText = (() => {
      const start = dateRange?.[0]?.format("YYYY-MM-DD") ?? "";
      const end = dateRange?.[1]?.format("YYYY-MM-DD") ?? "";
      if (start && end) return `Date Range: ${start} to ${end}`;
      if (start) return `Date Range: from ${start}`;
      if (end) return `Date Range: until ${end}`;

      if (rows.length === 0) return "Date Range: -";
      const minMax = rows.reduce(
        (acc, row) => {
          const startedAt = row.started_at
            ? new Date(row.started_at).getTime()
            : NaN;
          if (Number.isNaN(startedAt)) return acc;
          return {
            min: Math.min(acc.min, startedAt),
            max: Math.max(acc.max, startedAt),
          };
        },
        { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      );

      if (
        !Number.isFinite(minMax.min) ||
        !Number.isFinite(minMax.max) ||
        minMax.min === Number.POSITIVE_INFINITY ||
        minMax.max === Number.NEGATIVE_INFINITY
      ) {
        return "Date Range: -";
      }

      const formatDate = (value: number) => {
        const date = new Date(value);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      return `Date Range: ${formatDate(minMax.min)} to ${formatDate(minMax.max)}`;
    })();
    const titleText = `${projectName ?? "Project"} - ${
      userDisplayName || "User"
    }`;

    const columnCount = exportColumns.length;
    const padRow = (row: Array<string | number>) => {
      const padded = [...row];
      while (padded.length < columnCount) padded.push("");
      return padded;
    };

    const sheetRows: Array<Array<string | number>> = [];
    sheetRows.push(padRow([titleText]));
    sheetRows.push(padRow([rangeText]));
    sheetRows.push(padRow([]));
    const headerRowIndex = sheetRows.length;
    sheetRows.push(padRow(exportColumns));
    sheetRows.push(padRow([]));
    sheetRows.push(...exportRows.map((row) => padRow(row)));
    sheetRows.push(padRow([]));
    const totalRowIndex = sheetRows.length;
    sheetRows.push(padRow(totalRow));
    sheetRows.push(padRow([]));
    const signatureRowIndex = sheetRows.length;
    sheetRows.push(padRow([`Downloaded Date - ${downloadDate}`]));

    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    const lastColumnIndex = columnCount - 1;

    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumnIndex } },
      {
        s: { r: signatureRowIndex, c: 0 },
        e: { r: signatureRowIndex, c: lastColumnIndex },
      },
    ];

    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastColumnIndex } });

    ws["!merges"] = merges;

    const applyBoldRow = (rowIndex: number) => {
      for (let c = 0; c < columnCount; c += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c });
        const cell = ws[cellRef];
        if (!cell) continue;
        cell.s = {
          ...(cell.s ?? {}),
          font: { ...(cell.s?.font ?? {}), bold: true },
        };
      }
    };

    applyBoldRow(0);
    applyBoldRow(headerRowIndex);
    applyBoldRow(totalRowIndex);
    applyBoldRow(signatureRowIndex);

    ws["!cols"] = exportColumns.map((header, index) => {
      let maxLen = header.length;
      for (const row of exportRows) {
        const value = row[index];
        if (value !== null && value !== undefined) {
          maxLen = Math.max(maxLen, String(value).length);
        }
      }
      const totalValue = totalRow[index];
      if (totalValue !== null && totalValue !== undefined) {
        maxLen = Math.max(maxLen, String(totalValue).length);
      }
      return { wch: Math.min(60, Math.max(10, maxLen + 2)) };
    });

    const excelBorderRgb = (
      getCssVarValue("--color-excel-border") ||
      getCssVarValue("--color-border-subtle")
    )
      .replace("#", "")
      .toUpperCase();
    const borderStyle = {
      top: { style: "thin", color: { rgb: excelBorderRgb } },
      bottom: { style: "thin", color: { rgb: excelBorderRgb } },
      left: { style: "thin", color: { rgb: excelBorderRgb } },
      right: { style: "thin", color: { rgb: excelBorderRgb } },
    } as const;

    if (ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r; r <= range.e.r; r += 1) {
        for (let c = range.s.c; c <= range.e.c; c += 1) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          const cell = ws[cellRef] ?? { t: "s", v: "" };
          cell.s = { ...(cell.s ?? {}), border: borderStyle };
          ws[cellRef] = cell;
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");

    const safeProjectName =
      projectName
        ?.trim()
        .replace(/[^a-zA-Z0-9-_ ]/g, "")
        .replace(/\s+/g, "-") || "project";
    const safeUserName =
      userDisplayName
        ?.trim()
        .replace(/[^a-zA-Z0-9-_ ]/g, "")
        .replace(/\s+/g, "-") || "user";
    const fileName = `${safeProjectName}-${safeUserName}-${downloadDate}.xlsx`;
    XLSX.writeFile(wb, fileName, { cellStyles: true });
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
      responsive: ["md"],
      render: (value: string) => formatDateTimeYmdHms(value),
    },
    {
      title: "Ended",
      dataIndex: "ended_at",
      key: "ended_at",
      width: 190,
      responsive: ["md"],
      render: (value: string | null) => formatDateTimeYmdHms(value),
    },
    {
      title: "Duration",
      dataIndex: "duration_ms",
      key: "duration_ms",
      width: 140,
      render: (value: number, record) => (
        <div className="history-table__duration-cell">
          <span
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontWeight: 600,
            }}
          >
            {formatDuration(value)}
          </span>
          <Tag
            className="history-table__mobile-status"
            color={statusTagColors[record.status]}
            style={{
              color: statusTextColors[record.status],
              border: "none",
              borderRadius: 999,
            }}
          >
            {formatStatusLabel(record.status)}
          </Tag>
        </div>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      responsive: ["md"],
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
  ];

  const getContextMenuPosition = (x: number, y: number) => {
    const menuWidth = 180;
    const menuHeight = 132;
    const padding = 8;
    const maxX = window.innerWidth - menuWidth - padding;
    const maxY = window.innerHeight - menuHeight - padding;
    return {
      x: Math.max(padding, Math.min(x, maxX)),
      y: Math.max(padding, Math.min(y, maxY)),
    };
  };

  const clearLongPress = () => {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const openView = (task: TaskRow) => {
    setViewTask(task);
    setContextMenu(null);
    setSwipedRowId(null);
  };

  const openEdit = (task: TaskRow) => {
    setEditingTask(task);
    setModalOpen(true);
    setContextMenu(null);
    setSwipedRowId(null);
  };

  const openContextMenuAt = (task: TaskRow, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const position = getContextMenuPosition(rect.right, rect.bottom);
    setContextMenu({ task, ...position });
    setSwipedRowId(null);
  };

  const openDelete = (task: TaskRow) => {
    if (!canDeleteTask(task)) return;
    setDeleteTarget(task);
    setDeleteModalOpen(true);
    setContextMenu(null);
    setSwipedRowId(null);
  };

  return (
    <div
      className={`history-table${isMobileView ? " history-table--mobile" : ""}`}
    >
      <div className="history-table__header">
        <div className="history-table__summary">
          <Typography.Title level={5} style={{ marginBottom: 0 }}>
            Task List{projectName ? ` - ${projectName}` : ""}
          </Typography.Title>
        </div>

        <Space className="history-table__actions" size="middle">
          {dateRange ? (
            <Typography.Text type="secondary">
              Selected range total:{" "}
              <span style={{ fontWeight: 600 }}>
                {isRangeDurationLoading
                  ? "Calculating..."
                  : rangeDurationMs === null
                    ? "-"
                    : formatDuration(rangeDurationMs)}
              </span>
            </Typography.Text>
          ) : null}
          <div className="history-table__range">
            <RangePicker
              value={dateRange}
              onChange={(value) => {
                setDateRange(value);
                setPage(0);
              }}
              allowClear
              format="YYYY-MM-DD"
              placeholder={["Start date", "End date"]}
              inputReadOnly
              getPopupContainer={(trigger) =>
                trigger.parentElement ?? document.body
              }
              popupClassName="history-table__range-popup"
            />
          </div>
          <Button
            icon={<DownloadOutlined />}
            onClick={downloadExcel}
            disabled={rows.length === 0}
            className="history-table__download"
          >
            Download Excel
          </Button>
        </Space>
      </div>

      {isMobileView ? (
        <Pagination
          className="history-table__pagination history-table__pagination--top"
          current={page + 1}
          pageSize={PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          onChange={(nextPage) => setPage(nextPage - 1)}
        />
      ) : (
        <Pagination
          className="history-table__pagination"
          current={page + 1}
          pageSize={PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          onChange={(nextPage) => setPage(nextPage - 1)}
        />
      )}

      {isMobileView ? (
        <>
          <div className="history-table__cards">
          {isLoading ? (
            <Typography.Text type="secondary">Loading...</Typography.Text>
          ) : rows.length === 0 ? (
            <Typography.Text type="secondary">No history yet.</Typography.Text>
          ) : (
            rows.map((record) => (
              <div key={record.id} className="history-table__card">
                <div className="history-table__card-header">
                  <div className="history-table__card-title">
                    <Typography.Text strong>
                      {record.title}
                    </Typography.Text>
                    {record.notes ? (
                      <Typography.Text type="secondary">
                        {record.notes}
                      </Typography.Text>
                    ) : null}
                  </div>
                  <Button
                    type="text"
                    icon={<MoreOutlined />}
                    aria-label="Task actions"
                    onClick={(event) =>
                      openContextMenuAt(
                        record,
                        event.currentTarget as HTMLElement,
                      )
                    }
                  />
                </div>
                <div className="history-table__card-meta">
                  <span className="history-table__card-duration">
                    {formatDuration(getDisplayDurationMs(record))}
                  </span>
                  <Tag
                    color={statusTagColors[record.status]}
                    style={{
                      color: statusTextColors[record.status],
                      border: "none",
                      borderRadius: 999,
                    }}
                  >
                    {formatStatusLabel(record.status)}
                  </Tag>
                </div>
                <div className="history-table__card-times">
                  <span>
                    Started: {formatDateTimeYmdHms(record.started_at)}
                  </span>
                  <span>
                    Ended: {formatDateTimeYmdHms(record.ended_at)}
                  </span>
                </div>
              </div>
            ))
          )}
          </div>
        </>
      ) : (
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
            rowClassName={(record) =>
              `history-table__row${
                swipedRowId === record.id ? " is-swiped" : ""
              }`
            }
            onRow={(record) => ({
              onContextMenu: (event) => {
                event.preventDefault();
                const position = getContextMenuPosition(
                  event.clientX,
                  event.clientY,
                );
                setContextMenu({ task: record, ...position });
              },
              onPointerDown: (event) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                clearLongPress();
                longPressTriggeredRef.current = false;
                swipeStateRef.current = {
                  rowId: record.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  lastX: event.clientX,
                  lastY: event.clientY,
                  moved: false,
                  pointerId: event.pointerId,
                  pointerType: event.pointerType,
                };
                if (event.pointerType === "touch") {
                  const { clientX, clientY } = event;
                  longPressTimeoutRef.current = window.setTimeout(() => {
                    if (swipeStateRef.current.moved) return;
                    longPressTriggeredRef.current = true;
                    const position = getContextMenuPosition(clientX, clientY);
                    setContextMenu({ task: record, ...position });
                    setSwipedRowId(null);
                  }, 450);
                }
                event.currentTarget.setPointerCapture?.(event.pointerId);
              },
              onPointerMove: (event) => {
                if (
                  swipeStateRef.current.rowId !== record.id ||
                  swipeStateRef.current.pointerId !== event.pointerId
                ) {
                  return;
                }
                const nextX = event.clientX;
                const nextY = event.clientY;
                const dx = nextX - swipeStateRef.current.startX;
                const dy = nextY - swipeStateRef.current.startY;
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                  swipeStateRef.current.moved = true;
                  clearLongPress();
                }
                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
                  event.preventDefault();
                }
                swipeStateRef.current.lastX = nextX;
                swipeStateRef.current.lastY = nextY;
              },
              onPointerUp: (event) => {
                if (
                  swipeStateRef.current.rowId !== record.id ||
                  swipeStateRef.current.pointerId !== event.pointerId
                ) {
                  return;
                }
                clearLongPress();
                const endX = event.clientX ?? swipeStateRef.current.lastX;
                const endY = event.clientY ?? swipeStateRef.current.lastY;
                const dx = endX - swipeStateRef.current.startX;
                const dy = endY - swipeStateRef.current.startY;
                const isHorizontal = Math.abs(dx) > Math.abs(dy);
                const threshold = 40;
                if (longPressTriggeredRef.current) {
                  longPressTriggeredRef.current = false;
                } else if (isHorizontal && Math.abs(dx) > threshold) {
                  if (dx > 0) {
                    setSwipedRowId(record.id);
                  } else {
                    setSwipedRowId(null);
                  }
                } else if (!swipeStateRef.current.moved) {
                  setSwipedRowId((prev) =>
                    prev === record.id ? null : prev,
                  );
                }
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                swipeStateRef.current = {
                  rowId: null,
                  startX: 0,
                  startY: 0,
                  lastX: 0,
                  lastY: 0,
                  moved: false,
                  pointerId: null,
                  pointerType: null,
                };
              },
              onPointerCancel: (event) => {
                if (swipeStateRef.current.pointerId === event.pointerId) {
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                }
                clearLongPress();
                longPressTriggeredRef.current = false;
                swipeStateRef.current = {
                  rowId: null,
                  startX: 0,
                  startY: 0,
                  lastX: 0,
                  lastY: 0,
                  moved: false,
                  pointerId: null,
                  pointerType: null,
                };
              },
            })}
          />
        </div>
      )}

      {contextMenu ? (
        <div
          role="menu"
          aria-label="Task actions"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            background: colors.surface,
            borderRadius: 8,
            boxShadow: `0 10px 24px ${colors.shadowStrong}`,
            padding: 4,
            minWidth: 160,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            type="text"
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-start",
            }}
            icon={<EditOutlined />}
            disabled={contextMenu.task.status === "running"}
            onClick={() => openEdit(contextMenu.task)}
          >
            Edit
          </Button>
          <Button
            type="text"
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-start",
            }}
            icon={<EyeOutlined />}
            onClick={() => openView(contextMenu.task)}
          >
            View
          </Button>
          <Button
            type="text"
            danger
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-start",
            }}
            icon={<DeleteOutlined />}
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
            style={{
              backgroundColor: colors.success,
              borderColor: colors.success,
            }}
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
          style: { backgroundColor: colors.danger, borderColor: colors.danger },
        }}
        cancelButtonProps={{
          style: {
            backgroundColor: colors.warning,
            borderColor: colors.warning,
            color: colors.slate900,
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
