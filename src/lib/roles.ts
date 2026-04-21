// Role system — strict enforcement based on email domain
// Assessor: @mimimomentum.com — review, evaluate, feedback ONLY
// Doer/Owner: @eonexea.com — create, edit, manage, upload, respond (NO feedback)

export type AppRole = "assessor" | "doer" | "admin";

export function detectRole(email: string): AppRole {
  if (!email) return "doer";
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain === "mimimomentum.com") return "assessor";
  if (email === "admin@eonexea.com" || email === "resources@eonexea.com" || email === "leah@eonexea.com") return "admin";
  return "doer";
}

export const ROLE_LABELS: Record<AppRole, string> = {
  assessor: "Rep",
  doer: "Owner",
  admin: "Admin",
};

export const ROLE_COLORS: Record<AppRole, string> = {
  assessor: "bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400",
  doer: "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
  admin: "bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400",
};

// Doer permissions — @eonexea.com
export function canEditTasks(role: AppRole): boolean { return role === "doer" || role === "admin"; }
export function canCreateTasks(role: AppRole): boolean { return role === "doer" || role === "admin"; }
export function canUploadDeliverables(role: AppRole): boolean { return role === "doer" || role === "admin"; }
export function canDeleteTasks(role: AppRole): boolean { return role === "admin"; }
export function canDeleteDeliverables(role: AppRole): boolean { return role === "doer" || role === "admin"; }
export function canAddEOD(role: AppRole): boolean { return role === "doer" || role === "admin"; }

// Assessor permissions — @mimimomentum.com ONLY (not admin)
export function canGiveFeedback(role: AppRole): boolean { return role === "assessor"; }
export function canEditFeedback(role: AppRole): boolean { return role === "assessor"; }
export function canDeleteFeedback(role: AppRole): boolean { return role === "assessor"; }
export function canOverrideScores(role: AppRole): boolean { return role === "assessor"; }

// Owner Maps — admin-only edits
export function canEditOwnerMaps(role: AppRole): boolean { return role === "admin"; }
