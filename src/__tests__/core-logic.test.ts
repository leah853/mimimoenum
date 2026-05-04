import { validate, safeJson } from "@/lib/api-helpers";
import { isReplyComment, calcScore, handleApiError, formatDate } from "@/lib/utils";
import { detectRole, canEditTasks, canGiveFeedback, canDeleteTasks, canUploadDeliverables, canAddEOD } from "@/lib/roles";
import { FIXED_CATEGORIES, CAT_COLORS, CAT_SHORT, OWNER_STYLE } from "@/lib/constants";
import { getCompletionBlockers } from "@/lib/business-rules";

// ============================================
// VALIDATION
// ============================================
describe("validate()", () => {
  test("rejects missing required fields", () => {
    expect(validate({}, ["title"])).toBe("Missing required field: title");
    expect(validate({ title: null }, ["title"])).toBe("Missing required field: title");
    expect(validate({ title: undefined }, ["title"])).toBe("Missing required field: title");
    expect(validate({ title: "" }, ["title"])).toBe("Missing required field: title");
  });

  test("rejects whitespace-only strings", () => {
    expect(validate({ title: "   " }, ["title"])).toBe("title cannot be blank");
    expect(validate({ title: "\t\n" }, ["title"])).toBe("title cannot be blank");
  });

  test("passes valid data", () => {
    expect(validate({ title: "Real title", owner: "John" }, ["title", "owner"])).toBeNull();
  });

  test("allows zero as valid value", () => {
    expect(validate({ count: 0 }, ["count"])).toBeNull();
  });

  test("allows false as valid value", () => {
    expect(validate({ active: false }, ["active"])).toBeNull();
  });

  test("validates multiple fields", () => {
    expect(validate({ title: "ok" }, ["title", "description"])).toBe("Missing required field: description");
  });
});

// ============================================
// REPLY DETECTION
// ============================================
describe("isReplyComment()", () => {
  test("detects reply with ↩️ emoji", () => {
    expect(isReplyComment("↩️ Reply to Sky: ok")).toBe(true);
  });

  test("detects reply with unicode escape", () => {
    expect(isReplyComment("\u21a9\ufe0f Reply to Sky: ok")).toBe(true);
  });

  test("detects reply with text prefix", () => {
    expect(isReplyComment("Reply to Sky: done")).toBe(true);
  });

  test("returns false for normal comments", () => {
    expect(isReplyComment("Great work on the deliverable")).toBe(false);
    expect(isReplyComment("This needs improvement")).toBe(false);
  });

  test("handles null/undefined/empty", () => {
    expect(isReplyComment(null)).toBe(false);
    expect(isReplyComment(undefined)).toBe(false);
    expect(isReplyComment("")).toBe(false);
  });
});

// ============================================
// SCORE CALCULATION
// ============================================
describe("calcScore()", () => {
  test("returns 0 for empty array", () => {
    expect(calcScore([])).toBe(0);
  });

  test("returns 10 for all completed", () => {
    expect(calcScore([{ status: "completed" }, { status: "completed" }])).toBe(10);
  });

  test("returns 0 for none completed", () => {
    expect(calcScore([{ status: "not_started" }, { status: "in_progress" }])).toBe(0);
  });

  test("returns correct ratio", () => {
    expect(calcScore([{ status: "completed" }, { status: "in_progress" }])).toBe(5);
    expect(calcScore([
      { status: "completed" },
      { status: "completed" },
      { status: "in_progress" },
      { status: "not_started" },
    ])).toBe(5);
  });
});

// ============================================
// ERROR HANDLING
// ============================================
describe("handleApiError()", () => {
  test("handles Error objects", () => {
    expect(handleApiError(new Error("fail"))).toBe("fail");
  });

  test("handles strings", () => {
    expect(handleApiError("something broke")).toBe("something broke");
  });

  test("handles unknown types", () => {
    expect(handleApiError(42)).toBe("An unexpected error occurred");
    expect(handleApiError(null)).toBe("An unexpected error occurred");
    expect(handleApiError(undefined)).toBe("An unexpected error occurred");
    expect(handleApiError({})).toBe("An unexpected error occurred");
  });
});

// ============================================
// DATE FORMATTING
// ============================================
describe("formatDate()", () => {
  test("formats date correctly", () => {
    const result = formatDate("2026-04-09");
    expect(result).toContain("Apr");
    expect(result).toContain("9");
  });

  test("formats different months", () => {
    expect(formatDate("2026-01-15")).toContain("Jan");
    expect(formatDate("2026-07-01")).toContain("Jul");
  });
});

// ============================================
// ROLE SYSTEM
// ============================================
describe("detectRole()", () => {
  test("assessor from mimimomentum.com", () => {
    expect(detectRole("rep@mimimomentum.com")).toBe("assessor");
    expect(detectRole("rep2@mimimomentum.com")).toBe("assessor");
  });

  test("admin from eonexea.com (Leah/Resources)", () => {
    expect(detectRole("leah@eonexea.com")).toBe("admin");
    expect(detectRole("resources@eonexea.com")).toBe("admin");
  });

  test("doer from eonexea.com", () => {
    expect(detectRole("chloe@eonexea.com")).toBe("doer");
    expect(detectRole("nate@eonexea.com")).toBe("doer");
  });

  test("handles empty email", () => {
    expect(detectRole("")).toBe("doer");
  });
});

describe("Role permissions", () => {
  test("doers can edit tasks", () => {
    expect(canEditTasks("doer")).toBe(true);
    expect(canEditTasks("admin")).toBe(true);
    expect(canEditTasks("assessor")).toBe(false);
  });

  test("only assessors can give feedback", () => {
    expect(canGiveFeedback("assessor")).toBe(true);
    expect(canGiveFeedback("doer")).toBe(false);
    expect(canGiveFeedback("admin")).toBe(false);
  });

  test("only admins can delete tasks", () => {
    expect(canDeleteTasks("admin")).toBe(true);
    expect(canDeleteTasks("doer")).toBe(false);
    expect(canDeleteTasks("assessor")).toBe(false);
  });

  test("doers can upload deliverables", () => {
    expect(canUploadDeliverables("doer")).toBe(true);
    expect(canUploadDeliverables("admin")).toBe(true);
    expect(canUploadDeliverables("assessor")).toBe(false);
  });

  test("doers can add EOD", () => {
    expect(canAddEOD("doer")).toBe(true);
    expect(canAddEOD("admin")).toBe(true);
    expect(canAddEOD("assessor")).toBe(false);
  });
});

// ============================================
// CONSTANTS INTEGRITY
// ============================================
describe("Constants", () => {
  test("FIXED_CATEGORIES has 6 items", () => {
    expect(FIXED_CATEGORIES).toHaveLength(7);
  });

  test("FIXED_CATEGORIES includes all required categories (apex + foundations)", () => {
    expect(FIXED_CATEGORIES).toContain("Milestone Execution");
    expect(FIXED_CATEGORIES).toContain("Workflows");
    expect(FIXED_CATEGORIES).toContain("Product & Engineering");
    expect(FIXED_CATEGORIES).toContain("Cybersecurity / Compliance");
    expect(FIXED_CATEGORIES).toContain("Talent Acquisition");
    expect(FIXED_CATEGORIES).toContain("Training & Culture");
    expect(FIXED_CATEGORIES).toContain("Branding");
  });

  test("CAT_COLORS has entry for each category", () => {
    for (const cat of FIXED_CATEGORIES) {
      expect(CAT_COLORS[cat]).toBeDefined();
      expect(CAT_COLORS[cat]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("CAT_SHORT has entry for each category", () => {
    for (const cat of FIXED_CATEGORIES) {
      expect(CAT_SHORT[cat]).toBeDefined();
      expect(CAT_SHORT[cat].length).toBeLessThan(20);
    }
  });

  test("OWNER_STYLE has Leah and Chloe", () => {
    expect(OWNER_STYLE["Leah"]).toBeDefined();
    expect(OWNER_STYLE["Leah"].text).toContain("pink");
    expect(OWNER_STYLE["Chloe"]).toBeDefined();
    expect(OWNER_STYLE["Chloe"].text).toContain("cyan");
  });
});

// ============================================
// BUSINESS RULES
// ============================================
describe("getCompletionBlockers()", () => {
  test("blocks completion without deliverable", () => {
    const blockers = getCompletionBlockers({
      deliverables: [],
      feedback: [{ id: "1" }],
    } as any);
    expect(blockers).toContain("No deliverable uploaded");
  });

  test("blocks completion without feedback", () => {
    const blockers = getCompletionBlockers({
      deliverables: [{ id: "1" }],
      feedback: [],
    } as any);
    expect(blockers).toContain("No feedback received");
  });

  test("allows completion with both", () => {
    const blockers = getCompletionBlockers({
      deliverables: [{ id: "1" }],
      feedback: [{ id: "1" }],
    } as any);
    expect(blockers).toHaveLength(0);
  });

  test("blocks completion with neither", () => {
    const blockers = getCompletionBlockers({} as any);
    expect(blockers).toHaveLength(2);
  });
});
