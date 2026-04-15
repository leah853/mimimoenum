"use client";

import { useState } from "react";
import { useApi, apiPost } from "@/lib/use-api";
import type { Task } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";

interface EODFormProps {
  onSubmitted: () => void;
}

export default function EODForm({ onSubmitted }: EODFormProps) {
  const { dbUser } = useAuth();
  const { data: tasksData } = useApi<Task[]>("/api/tasks");
  const [whatWasDone, setWhatWasDone] = useState("");
  const [whatsNext, setWhatsNext] = useState("");
  const [blockers, setBlockers] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const tasks = (tasksData || []).filter((t) => t.status !== "completed");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dbUser || !whatWasDone) return;
    setSubmitting(true);
    try {
      await apiPost("/api/eod", {
        user_id: dbUser.id,
        date: new Date().toISOString().split("T")[0],
        what_was_done: whatWasDone,
        whats_next: whatsNext || null,
        blockers: blockers || null,
        linked_task_ids: selectedTasks,
      });
      setWhatWasDone(""); setWhatsNext(""); setBlockers(""); setSelectedTasks([]);
      onSubmitted();
    } catch (e) { console.error(e); }
    setSubmitting(false);
  }

  const toggleTask = (taskId: string) => {
    setSelectedTasks((prev) => prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Submit EOD Update</h2>
      <div>
        <label className="text-sm text-gray-500 mb-1 block">What was done today? *</label>
        <textarea value={whatWasDone} onChange={(e) => setWhatWasDone(e.target.value)} required rows={4}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm" />
      </div>
      <div>
        <label className="text-sm text-gray-500 mb-1 block">What&apos;s next?</label>
        <textarea value={whatsNext} onChange={(e) => setWhatsNext(e.target.value)} rows={2}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm" />
      </div>
      <div>
        <label className="text-sm text-gray-500 mb-1 block">Obstacles</label>
        <textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm" />
      </div>
      {tasks.length > 0 && (
        <div>
          <label className="text-sm text-gray-500 mb-2 block">Link to Tasks</label>
          <div className="max-h-40 overflow-y-auto space-y-1 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
            {tasks.map((task) => (
              <label key={task.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded cursor-pointer">
                <input type="checkbox" checked={selectedTasks.includes(task.id)} onChange={() => toggleTask(task.id)} className="rounded border-gray-300 dark:border-gray-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{task.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <button type="submit" disabled={submitting || !whatWasDone}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800 text-white text-sm rounded-lg">
        {submitting ? "Submitting..." : "Submit EOD Update"}
      </button>
    </form>
  );
}
