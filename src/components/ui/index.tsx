"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { STATUS_COLORS, STATUS_LABELS, type TaskStatus } from "@/lib/types";
import { HiCheck, HiX } from "react-icons/hi";

// ============================================
// GRADIENT BUTTON
// ============================================
export function GradientButton({
  children, onClick, disabled, variant = "primary", size = "md", className = "",
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg"; className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 active:scale-[0.97]";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" };
  const variants = {
    primary: "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md hover:shadow-lg hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100",
    secondary: "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md hover:shadow-lg hover:brightness-110 disabled:opacity-50",
    ghost: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

// ============================================
// STATUS BADGE
// ============================================
export function StatusBadge({ status, size = "sm" }: { status: TaskStatus; size?: "sm" | "md" }) {
  const cls = size === "md" ? "text-xs px-3 py-1" : "text-[11px] px-2 py-0.5";
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full transition-all ${cls}`}
      style={{ backgroundColor: STATUS_COLORS[status] + "18", color: STATUS_COLORS[status] }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ============================================
// CARD
// ============================================
export function Card({
  children, className = "", hover = false, gradient = false, glow = false,
}: {
  children: ReactNode; className?: string; hover?: boolean; gradient?: boolean; glow?: boolean;
}) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl
      ${hover ? "interactive" : ""}
      ${gradient ? "gradient-border" : ""}
      ${glow ? "glow-indigo" : ""}
      ${className}`}>
      {children}
    </div>
  );
}

// ============================================
// KPI CARD
// ============================================
export function KPICard({ label, value, color = "text-gray-900 dark:text-white", accent }: {
  label: string; value: string | number; color?: string; accent?: "green" | "blue" | "red" | "yellow";
}) {
  const accents = {
    green: "from-green-500/10 to-emerald-500/5 border-green-200 dark:border-green-800/30",
    blue: "from-blue-500/10 to-cyan-500/5 border-blue-200 dark:border-blue-800/30",
    red: "from-red-500/10 to-pink-500/5 border-red-200 dark:border-red-800/30",
    yellow: "from-yellow-500/10 to-amber-500/5 border-yellow-200 dark:border-yellow-800/30",
  };
  const bg = accent ? `bg-gradient-to-br ${accents[accent]}` : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800";
  return (
    <div className={`rounded-2xl border p-4 interactive animate-fade-in ${bg}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ============================================
// PROGRESS BAR
// ============================================
export function ProgressBar({ value, size = "md", animated = true }: { value: number; size?: "sm" | "md"; animated?: boolean }) {
  const h = size === "sm" ? "h-1.5" : "h-2.5";
  return (
    <div className={`${h} bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden`}>
      <div
        className={`${h} rounded-full ${animated ? "progress-animated" : "bg-indigo-500"}`}
        style={{ width: `${Math.min(value, 100)}%`, transition: "width 0.6s ease" }}
      />
    </div>
  );
}

// ============================================
// SCORE PILL
// ============================================
export function ScorePill({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  const bg = score >= 7 ? "from-green-500 to-emerald-500" : score > 0 ? "from-yellow-500 to-amber-500" : "from-gray-400 to-gray-500";
  const cls = size === "lg" ? "text-sm font-bold px-3 py-1" : "text-[10px] font-bold px-2 py-0.5";
  return (
    <span className={`rounded-full bg-gradient-to-r ${bg} text-white ${cls}`}>
      {score.toFixed(1)}/10
    </span>
  );
}

// ============================================
// EMPTY STATE
// ============================================
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-900/30 dark:to-violet-900/30 flex items-center justify-center mb-4">
        <span className="text-2xl">📋</span>
      </div>
      <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-4 text-center max-w-sm">{description}</p>
      {action}
    </div>
  );
}

// ============================================
// LOADING SKELETON
// ============================================
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center">
          <Skeleton className="w-3 h-3 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ============================================
// TOAST SYSTEM
// ============================================
type Toast = { id: string; message: string; type: "success" | "error" | "info" };
const ToastContext = createContext<{ toast: (msg: string, type?: Toast["type"]) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-toast-in flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
            ${t.type === "success" ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white" :
              t.type === "error" ? "bg-gradient-to-r from-red-500 to-pink-500 text-white" :
              "bg-white dark:bg-gray-800 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-700"}`}>
            {t.type === "success" && <HiCheck className="w-4 h-4" />}
            {t.type === "error" && <HiX className="w-4 h-4" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }
