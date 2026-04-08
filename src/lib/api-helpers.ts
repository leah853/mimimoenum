import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function validate(body: Record<string, unknown>, required: string[]): string | null {
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}
