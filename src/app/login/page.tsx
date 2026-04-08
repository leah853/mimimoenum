"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HiEye, HiEyeOff } from "react-icons/hi";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Login failed"); setLoading(false); return; }
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-indigo-950/20 flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-scale-in">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold gradient-text tracking-tight">Mimimomentum</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">Execution + Review System</p>
        </div>

        <form onSubmit={handleLogin}
          className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 space-y-5 shadow-xl shadow-indigo-500/5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@eonexea.com" required
              className="w-full px-4 py-3 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Password</label>
            <div className="relative">
              <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required
                className="w-full px-4 py-3 pr-12 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                {showPassword ? <HiEyeOff className="w-5 h-5" /> : <HiEye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-all duration-200 active:scale-[0.98]">
            {loading ? "Signing in..." : "Sign In"}
          </button>
          {error && <p className="text-red-500 text-sm text-center animate-fade-in">{error}</p>}
        </form>
      </div>
    </div>
  );
}
