"use client";

import { create } from "zustand";
import type { Task, TaskStatus } from "@/lib/types";
import { MOCK_TASKS } from "@/lib/mock-data";

interface TaskStore {
  tasks: Task[];
  getTask: (id: string) => Task | undefined;
  updateTask: (id: string, updates: Partial<Task>) => void;
  addTask: (task: Task) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [...MOCK_TASKS],
  getTask: (id) => get().tasks.find((t) => t.id === id),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
}));
