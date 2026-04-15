import { NextRequest, NextResponse } from "next/server";
import { validateUser, encodeSession, AUTH_COOKIE_NAME } from "@/lib/basic-auth";

export async function POST(request: NextRequest) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { email, password } = body;

  const user = validateUser(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = encodeSession(user);
  const response = NextResponse.json({
    success: true,
    user: { email: user.email, full_name: user.full_name, role: user.role },
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: false, // needs to be readable by client for auth context
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
