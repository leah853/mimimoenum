export interface BasicUser {
  email: string;
  password: string;
  full_name: string;
  role: "admin" | "eonexea" | "mimimomentum";
}

export const ALLOWED_USERS: BasicUser[] = [
  // Doer / Owner accounts (@eonexea.com)
  { email: "resources@eonexea.com", password: "Eonexea@2026!", full_name: "Resources", role: "admin" },
  { email: "leah@eonexea.com", password: "Eonexea@2026!", full_name: "Leah", role: "admin" },
  { email: "chloe@eonexea.com", password: "Eonexea@2026!", full_name: "Chloe", role: "eonexea" },
  { email: "nate@eonexea.com", password: "Eonexea@2026!", full_name: "Nate", role: "eonexea" },
  // Assessor / Rep accounts (@mimimomentum.com)
  { email: "rep@mimimomentum.com", password: "Momentum@2026!", full_name: "Rep 1", role: "mimimomentum" },
  { email: "rep2@mimimomentum.com", password: "Momentum@2026!", full_name: "Rep 2", role: "mimimomentum" },
];

export const AUTH_COOKIE_NAME = "mimimomentum_auth";

export function validateUser(email: string, password: string): BasicUser | null {
  return ALLOWED_USERS.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  ) || null;
}

export function encodeSession(user: BasicUser): string {
  const json = JSON.stringify({ email: user.email, full_name: user.full_name, role: user.role });
  if (typeof btoa === "function") return btoa(json);
  return Buffer.from(json).toString("base64");
}

export function decodeSession(token: string): { email: string; full_name: string; role: string } | null {
  try {
    const decoded = typeof atob === "function" ? atob(token) : Buffer.from(token, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch { return null; }
}
