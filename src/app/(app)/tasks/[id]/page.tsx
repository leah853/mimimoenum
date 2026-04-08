"use client";

import dynamic from "next/dynamic";

const TaskDetail = dynamic(() => import("@/components/TaskDetail"), { ssr: false, loading: () => (
  <div className="p-8">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
  </div>
)});

export default function TaskDetailPage() {
  return <TaskDetail />;
}
