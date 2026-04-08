import { type NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "mimimomentum_auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, API routes, and static assets
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get(AUTH_COOKIE);
  if (!authCookie?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Verify the cookie is valid JSON (basic check)
  try {
    const decoded = JSON.parse(atob(authCookie.value));
    if (!decoded.email || !decoded.role) {
      throw new Error("invalid");
    }
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
