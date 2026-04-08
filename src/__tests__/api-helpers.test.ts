import { validate } from "@/lib/api-helpers";

describe("API Helpers — validate", () => {
  test("returns null when all required fields present", () => {
    const result = validate({ title: "Test", owner_id: "123", deadline: "2026-04-06" }, ["title", "owner_id", "deadline"]);
    expect(result).toBeNull();
  });

  test("returns error for missing field", () => {
    const result = validate({ title: "Test" }, ["title", "owner_id"]);
    expect(result).toBe("Missing required field: owner_id");
  });

  test("returns error for empty string field", () => {
    const result = validate({ title: "", owner_id: "123" }, ["title"]);
    expect(result).toBe("Missing required field: title");
  });

  test("returns error for null field", () => {
    const result = validate({ title: null as unknown as string }, ["title"]);
    expect(result).toBe("Missing required field: title");
  });

  test("returns error for undefined field", () => {
    const result = validate({}, ["title"]);
    expect(result).toBe("Missing required field: title");
  });

  test("accepts zero as valid value", () => {
    const result = validate({ progress: 0 } as Record<string, unknown>, ["progress"]);
    expect(result).toBeNull();
  });
});
