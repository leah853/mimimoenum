"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import { detectRole, type AppRole } from "@/lib/roles";

interface AuthContextType {
  dbUser: User | null;
  appRole: AppRole;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  dbUser: null,
  appRole: "doer",
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [appRole, setAppRole] = useState<AppRole>("doer");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const [key, val] = c.trim().split("=");
      acc[key] = val;
      return acc;
    }, {} as Record<string, string>);

    const token = cookies[AUTH_COOKIE_NAME];
    if (token) {
      const session = decodeSession(decodeURIComponent(token));
      if (session) {
        const role = detectRole(session.email);
        setAppRole(role);

        fetch("/api/users")
          .then((r) => r.json())
          .then((users: { id: string; full_name: string; email: string; role: string }[]) => {
            const match = users.find((u) => u.email === session.email);
            setDbUser({
              id: match?.id || session.email,
              auth_id: match?.id || session.email,
              email: session.email,
              full_name: session.full_name,
              role: session.role as User["role"],
              created_at: new Date().toISOString(),
            });
            setLoading(false);
          })
          .catch(() => {
            setDbUser({
              id: session.email, auth_id: session.email, email: session.email,
              full_name: session.full_name, role: session.role as User["role"],
              created_at: new Date().toISOString(),
            });
            setLoading(false);
          });
        return;
      }
    }
    setLoading(false);
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setDbUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ dbUser, appRole, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
