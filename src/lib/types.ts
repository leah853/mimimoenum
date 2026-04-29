export type UserRole = "admin" | "eonexea" | "mimimomentum";
export type TaskStatus = "not_started" | "in_progress" | "under_review" | "completed" | "blocked";
export type FeedbackTag = "approved" | "needs_improvement" | "blocked";

export interface User {
  id: string;
  auth_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
}

export interface Quarter {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface Iteration {
  id: string;
  quarter_id: string;
  name: string;
  iteration_number: number;
  start_date: string;
  end_date: string;
}

export interface Week {
  id: string;
  iteration_id: string;
  week_number: number;
  start_date: string;
  end_date: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  category?: string;
  owner_id?: string;
  status: TaskStatus;
  deadline?: string;
  start_date?: string;
  end_date?: string;
  quarter_id?: string;
  iteration_id?: string;
  week_id?: string;
  progress: number;
  created_at: string;
  updated_at: string;
  owner?: User;
  subtasks?: Subtask[];
  deliverables?: Deliverable[];
  feedback?: Feedback[];
  dependencies_from?: { depends_on_task_id: string; depends_on_task: Task }[];
  dependencies_to?: { task_id: string; task: Task }[];
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  description?: string;
  owner_id?: string;
  status: TaskStatus;
  deadline?: string;
  start_date?: string;
  end_date?: string;
  created_at: string;
  owner?: User;
}

export interface Dependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
}

export interface Deliverable {
  id: string;
  task_id?: string;
  subtask_id?: string;
  title: string;
  file_url?: string;
  file_name?: string;
  version: number;
  uploaded_by?: string;
  viewed?: boolean;
  viewed_at?: string;
  created_at: string;
}

export interface Feedback {
  id: string;
  task_id?: string;
  subtask_id?: string;
  reviewer_id: string;
  rating: number;
  comment?: string;
  tag: FeedbackTag;
  acknowledged?: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  /** Slack/Gchat-style threading: when set, this feedback is a reply to another. */
  parent_id?: string | null;
  created_at: string;
  reviewer?: User;
}

export interface EODUpdate {
  id: string;
  user_id: string;
  date: string;
  what_was_done: string;
  whats_next?: string;
  blockers?: string;
  video_url?: string;
  created_at: string;
  user?: User;
  linked_tasks?: Task[];
  comments?: EODComment[];
}

export interface EODComment {
  id: string;
  eod_update_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  user?: User;
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  not_started: "#9CA3AF",
  in_progress: "#3B82F6",
  under_review: "#EAB308",
  completed: "#22C55E",
  blocked: "#EF4444",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  under_review: "Under Review",
  completed: "Completed",
  blocked: "Obstacle",
};
