// Shared constants — single source of truth for categories, owner styles, and colors.
//
// Structure (Q2 2026 onward):
//   APEX:        Milestone Execution + Branding — what we deliver + how we show up
//   PLATFORM:    Workflows · Product & Engineering · Cybersecurity / Compliance
//   PEOPLE:      Talent Acquisition · Training & Culture
// The three foundation groups are how we cluster the 7 categories in every
// grouped view (Tasks, Milestones, Dashboard, Deliverables).

export const FIXED_CATEGORIES = [
  "Milestone Execution",
  "Workflows",
  "Product & Engineering",
  "Cybersecurity / Compliance",
  "Talent Acquisition",
  "Training & Culture",
  "Branding",
] as const;

export type CategoryName = (typeof FIXED_CATEGORIES)[number];

// The 3 ordered groups. "apex" is the visually distinct top tier and now
// covers both Milestone Execution and Branding (clubbed per request — the
// outcome we deliver and how we show up sit together).
export type FoundationGroup = "apex" | "platform" | "people";

export const FOUNDATION_ORDER: readonly FoundationGroup[] = ["apex", "platform", "people"];

export const FOUNDATION_LABEL: Record<FoundationGroup, string> = {
  apex: "Milestone Execution & Branding",
  platform: "Platform — Core Engine",
  people: "People",
};

export const CATEGORY_GROUP: Record<string, FoundationGroup> = {
  "Milestone Execution":          "apex",
  "Branding":                     "apex",
  "Workflows":                    "platform",
  "Product & Engineering":        "platform",
  "Cybersecurity / Compliance":   "platform",
  "Talent Acquisition":           "people",
  "Training & Culture":           "people",
};

export const CAT_COLORS: Record<string, string> = {
  "Milestone Execution":          "#6366f1", // indigo (apex stays the original CS&PG color so existing data charts don't shift)
  "Workflows":                    "#0ea5e9", // sky
  "Product & Engineering":        "#3b82f6", // blue
  "Cybersecurity / Compliance":   "#ef4444", // red
  "Talent Acquisition":           "#10b981", // emerald
  "Training & Culture":           "#f59e0b", // amber
  "Branding":                     "#8b5cf6", // violet
};

export const CAT_SHORT: Record<string, string> = {
  "Milestone Execution":          "Milestone Exec",
  "Workflows":                    "Workflows",
  "Product & Engineering":        "Product & Eng",
  "Cybersecurity / Compliance":   "Cyber/Compliance",
  "Talent Acquisition":           "Talent",
  "Training & Culture":           "Training/Culture",
  "Branding":                     "Brand",
};

export const OWNER_STYLE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  Leah:  { text: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50/40 dark:bg-pink-900/10", border: "border-l-pink-400", dot: "#ec4899" },
  Chloe: { text: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50/40 dark:bg-cyan-900/10", border: "border-l-cyan-400", dot: "#06b6d4" },
};
