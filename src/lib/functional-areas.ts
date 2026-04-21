// Six canonical functional areas for Owner Maps.
// Slug is the stable enum (used as entity_id when entity_type='AREA').
// label is rep-facing; legacyCategory maps to FIXED_CATEGORIES so we can join
// against existing task/quarter_goal data without schema changes.
export const FUNCTIONAL_AREAS = [
  {
    slug: "VERTICAL_EXECUTION_CS",
    label: "Vertical Execution & Customer Success",
    short: "Vertical Execution & CS",
    legacyCategory: "Customer Success & PG Acquisition",
  },
  {
    slug: "PRODUCT_ENGINEERING",
    label: "Workflow / Product / Engineering",
    short: "Product / Eng",
    legacyCategory: "Product / Engineering / Workflows",
  },
  {
    slug: "CYBERSECURITY",
    label: "Cybersecurity",
    short: "Cybersecurity",
    legacyCategory: "Cybersecurity",
  },
  {
    slug: "BRANDING",
    label: "Branding",
    short: "Branding",
    legacyCategory: "Branding",
  },
  {
    slug: "KNOWLEDGE_CULTURE",
    label: "Knowledge & Culture",
    short: "Knowledge & Culture",
    legacyCategory: "Continuous Learning",
  },
  {
    slug: "TALENT_ACQUISITION",
    label: "Talent Acquisition",
    short: "Talent",
    legacyCategory: "Talent Acquisition",
  },
] as const;

export type AreaSlug = (typeof FUNCTIONAL_AREAS)[number]["slug"];
export const AREA_SLUGS: readonly string[] = FUNCTIONAL_AREAS.map((a) => a.slug);

export function isAreaSlug(s: string): s is AreaSlug {
  return AREA_SLUGS.includes(s);
}

export function areaLabel(slug: string): string {
  return FUNCTIONAL_AREAS.find((a) => a.slug === slug)?.label || slug;
}
