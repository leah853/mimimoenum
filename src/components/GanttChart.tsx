"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Task, Dependency } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS, TaskStatus } from "@/lib/types";
import Link from "next/link";

interface GanttChartProps {
  tasks: Task[];
  dependencies: Dependency[];
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => void;
}

const DAY_WIDTH = 32;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 60;

function daysBetween(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default function GanttChart({ tasks, dependencies, onTaskUpdate }: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{
    taskId: string;
    type: "move" | "resize-end";
    startX: number;
    origStart: Date;
    origEnd: Date;
  } | null>(null);

  // Calculate date range
  const allDates = tasks.flatMap((t) => {
    const dates: Date[] = [];
    if (t.start_date) dates.push(new Date(t.start_date));
    if (t.end_date) dates.push(new Date(t.end_date));
    if (t.deadline) dates.push(new Date(t.deadline));
    return dates;
  });

  const today = new Date();
  const minDate = allDates.length > 0
    ? new Date(Math.min(...allDates.map((d) => d.getTime()), today.getTime()))
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const maxDate = allDates.length > 0
    ? new Date(Math.max(...allDates.map((d) => d.getTime()), addDays(today, 90).getTime()))
    : addDays(today, 90);

  const chartStart = addDays(minDate, -7);
  const totalDays = daysBetween(chartStart, addDays(maxDate, 14));

  // Generate week labels
  const weeks: { label: string; startDay: number; days: number }[] = [];
  let d = new Date(chartStart);
  while (d <= addDays(maxDate, 14)) {
    const weekStart = new Date(d);
    const dayOffset = daysBetween(chartStart, weekStart);
    weeks.push({
      label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      startDay: dayOffset,
      days: 7,
    });
    d = addDays(d, 7);
  }

  const getTaskX = (task: Task) => {
    const start = task.start_date ? new Date(task.start_date) : today;
    return daysBetween(chartStart, start) * DAY_WIDTH;
  };

  const getTaskWidth = (task: Task) => {
    const start = task.start_date ? new Date(task.start_date) : today;
    const end = task.end_date ? new Date(task.end_date) : addDays(start, 14);
    return Math.max(daysBetween(start, end) * DAY_WIDTH, DAY_WIDTH * 2);
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, taskId: string, type: "move" | "resize-end") => {
      e.preventDefault();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      setDragging({
        taskId,
        type,
        startX: e.clientX,
        origStart: task.start_date ? new Date(task.start_date) : today,
        origEnd: task.end_date ? new Date(task.end_date) : addDays(today, 14),
      });
    },
    [tasks]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      const daysDelta = Math.round(dx / DAY_WIDTH);

      if (dragging.type === "move") {
        const newStart = addDays(dragging.origStart, daysDelta);
        const newEnd = addDays(dragging.origEnd, daysDelta);
        onTaskUpdate?.(dragging.taskId, {
          start_date: newStart.toISOString().split("T")[0],
          end_date: newEnd.toISOString().split("T")[0],
        });
      } else {
        const newEnd = addDays(dragging.origEnd, daysDelta);
        if (newEnd > dragging.origStart) {
          onTaskUpdate?.(dragging.taskId, {
            end_date: newEnd.toISOString().split("T")[0],
          });
        }
      }
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, onTaskUpdate]);

  // Build task index for dependency arrows
  const taskIndex = new Map(tasks.map((t, i) => [t.id, i]));

  // Today line position
  const todayX = daysBetween(chartStart, today) * DAY_WIDTH;

  return (
    <div className="flex border border-gray-800 rounded-xl overflow-hidden bg-gray-900">
      {/* Left panel - task names */}
      <div className="w-72 flex-shrink-0 border-r border-gray-800">
        <div
          className="px-4 flex items-center border-b border-gray-800 bg-gray-900/80 text-xs font-medium text-gray-400 uppercase tracking-wider"
          style={{ height: HEADER_HEIGHT }}
        >
          Task
        </div>
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center px-4 border-b border-gray-800/50 hover:bg-gray-800/30"
            style={{ height: ROW_HEIGHT }}
          >
            <div
              className="w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0"
              style={{ backgroundColor: STATUS_COLORS[task.status] }}
            />
            <Link
              href={`/tasks/${task.id}`}
              className="text-sm text-gray-200 hover:text-blue-400 truncate"
              title={task.title}
            >
              {task.title}
            </Link>
          </div>
        ))}
      </div>

      {/* Right panel - gantt bars */}
      <div className="flex-1 overflow-x-auto" ref={containerRef}>
        <div style={{ width: totalDays * DAY_WIDTH, minWidth: "100%" }}>
          {/* Header - weeks */}
          <div
            className="flex border-b border-gray-800 bg-gray-900/80 relative"
            style={{ height: HEADER_HEIGHT }}
          >
            {weeks.map((week, i) => (
              <div
                key={i}
                className="border-r border-gray-800/50 flex items-end pb-2 px-2"
                style={{
                  position: "absolute",
                  left: week.startDay * DAY_WIDTH,
                  width: week.days * DAY_WIDTH,
                }}
              >
                <span className="text-xs text-gray-500">{week.label}</span>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Today line */}
            <div
              className="absolute top-0 bottom-0 w-px bg-blue-500/40 z-10"
              style={{ left: todayX }}
            />

            {/* Grid lines (weekly) */}
            {weeks.map((week, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-gray-800/30"
                style={{ left: week.startDay * DAY_WIDTH }}
              />
            ))}

            {tasks.map((task, i) => (
              <div
                key={task.id}
                className="relative border-b border-gray-800/30"
                style={{ height: ROW_HEIGHT }}
              >
                {/* Task bar */}
                <div
                  className="absolute top-2 rounded-md cursor-grab active:cursor-grabbing group"
                  style={{
                    left: getTaskX(task),
                    width: getTaskWidth(task),
                    height: ROW_HEIGHT - 16,
                    backgroundColor: STATUS_COLORS[task.status],
                    opacity: 0.85,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, task.id, "move")}
                >
                  <div className="px-2 h-full flex items-center">
                    <span className="text-xs text-white font-medium truncate">
                      {task.title}
                    </span>
                  </div>

                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/20 rounded-r-md"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      handleMouseDown(e, task.id, "resize-end");
                    }}
                  />
                </div>
              </div>
            ))}

            {/* Dependency arrows */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{
                width: totalDays * DAY_WIDTH,
                height: tasks.length * ROW_HEIGHT,
              }}
            >
              {dependencies.map((dep) => {
                const fromIdx = taskIndex.get(dep.depends_on_task_id);
                const toIdx = taskIndex.get(dep.task_id);
                if (fromIdx === undefined || toIdx === undefined) return null;

                const fromTask = tasks[fromIdx];
                const toTask = tasks[toIdx];

                const x1 = getTaskX(fromTask) + getTaskWidth(fromTask);
                const y1 = fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                const x2 = getTaskX(toTask);
                const y2 = toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                const midX = x1 + (x2 - x1) / 2;

                return (
                  <g key={dep.id}>
                    <path
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="#6B7280"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                    {/* Arrow head */}
                    <polygon
                      points={`${x2},${y2} ${x2 - 6},${y2 - 4} ${x2 - 6},${y2 + 4}`}
                      fill="#6B7280"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
