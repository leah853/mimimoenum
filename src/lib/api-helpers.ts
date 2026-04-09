import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function validate(body: Record<string, unknown>, required: string[]): string | null {
  for (const field of required) {
    const val = body[field];
    if (val === undefined || val === null || val === "") {
      return `Missing required field: ${field}`;
    }
    if (typeof val === "string" && val.trim() === "") {
      return `${field} cannot be blank`;
    }
  }
  return null;
}

/** Safely parse request JSON — returns parsed body or null on malformed input */
export async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json(); } catch { return null; }
}
