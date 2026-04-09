// Shared constants — single source of truth for categories, owner styles, and colors

export const FIXED_CATEGORIES = [
  "Customer Success & PG Acquisition",
  "Product / Engineering / Workflows",
  "Cybersecurity",
  "Continuous Learning",
  "Talent Acquisition",
  "Branding",
] as const;

export type CategoryName = (typeof FIXED_CATEGORIES)[number];

export const CAT_COLORS: Record<string, string> = {
  "Customer Success & PG Acquisition": "#6366f1",
  "Product / Engineering / Workflows": "#3b82f6",
  "Cybersecurity": "#ef4444",
  "Continuous Learning": "#f59e0b",
  "Talent Acquisition": "#10b981",
  "Branding": "#8b5cf6",
};

export const CAT_SHORT: Record<string, string> = {
  "Customer Success & PG Acquisition": "CS & PG",
  "Product / Engineering / Workflows": "Engineering",
  "Cybersecurity": "Cyber",
  "Continuous Learning": "Learning",
  "Talent Acquisition": "Talent",
  "Branding": "Brand",
};

export const OWNER_STYLE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  Leah: { text: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50/40 dark:bg-pink-900/10", border: "border-l-pink-400", dot: "#ec4899" },
  Chloe: { text: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50/40 dark:bg-cyan-900/10", border: "border-l-cyan-400", dot: "#06b6d4" },
};
