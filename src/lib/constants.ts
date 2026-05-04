// Shared constants — single source of truth for categories, owner styles, and colors.
//
// Structure (Q2 2026 onward):
//   APEX:        Milestone Execution     — what we deliver (the outcome)
//   PLATFORM:    Workflows · Product & Engineering · Cybersecurity / Compliance
//   PEOPLE:      Talent Acquisition · Training & Culture
//   BRANDING:    Branding
// The four "groups" (apex + 3 foundations) are how we cluster the 7 categories
// in every grouped view (Tasks, Milestones, Owner Map, Dashboard, Gantt).

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

// The 4 ordered groups. "apex" is the visually distinct top tier.
export type FoundationGroup = "apex" | "platform" | "people" | "branding";

export const FOUNDATION_ORDER: readonly FoundationGroup[] = ["apex", "platform", "people", "branding"];

export const FOUNDATION_LABEL: Record<FoundationGroup, string> = {
  apex: "Milestone Execution",
  platform: "Platform — Core Engine",
  people: "People",
  branding: "Branding",
};

export const FOUNDATION_TAGLINE: Record<FoundationGroup, string> = {
  apex: "What we deliver",
  platform: "Workflows · Product & Engineering · Cybersecurity",
  people: "Talent Acquisition · Training & Culture",
  branding: "How we show up",
};

export const CATEGORY_GROUP: Record<string, FoundationGroup> = {
  "Milestone Execution":          "apex",
  "Workflows":                    "platform",
  "Product & Engineering":        "platform",
  "Cybersecurity / Compliance":   "platform",
  "Talent Acquisition":           "people",
  "Training & Culture":           "people",
  "Branding":                     "branding",
};

// Helper — group → its categories in render order
export function categoriesInGroup(group: FoundationGroup): CategoryName[] {
  return FIXED_CATEGORIES.filter((c) => CATEGORY_GROUP[c] === group);
}

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

// One-off display alias used by Owner Map and other views that prefer
// rep-facing language. Now identity for new names; kept for back-compat.
export const CATEGORY_ALIAS: Record<string, string> = {
  "Milestone Execution":          "Milestone Execution",
  "Workflows":                    "Workflows",
  "Product & Engineering":        "Product & Engineering",
  "Cybersecurity / Compliance":   "Cybersecurity / Compliance",
  "Training & Culture":           "Training & Culture",
  "Talent Acquisition":           "Talent Acquisition",
  "Branding":                     "Branding",
};

export const OWNER_STYLE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  Leah:  { text: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50/40 dark:bg-pink-900/10", border: "border-l-pink-400", dot: "#ec4899" },
  Chloe: { text: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50/40 dark:bg-cyan-900/10", border: "border-l-cyan-400", dot: "#06b6d4" },
};
