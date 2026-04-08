"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";
import {
  HiOutlineViewGrid, HiOutlineChartBar, HiOutlineClipboardList,
  HiOutlineDocumentText, HiOutlineUpload, HiOutlineLogout,
  HiOutlineTable, HiOutlineSun, HiOutlineMoon, HiOutlineAnnotation,
  HiOutlineVideoCamera,
} from "react-icons/hi";

const ZOOM_BASE = "https://us05web.zoom.us/j/84008799468?pwd=2N7Zq6UWhuYVSW3opb6T3xDJi34BXM.1";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: HiOutlineViewGrid },
  { href: "/milestones", label: "Milestones", icon: HiOutlineTable },
  { href: "/gantt", label: "Gantt View", icon: HiOutlineChartBar },
  { href: "/tasks", label: "Tasks", icon: HiOutlineClipboardList },
  { href: "/feedback", label: "Feedback Trail", icon: HiOutlineAnnotation },
  { href: "/eod", label: "EOD Updates", icon: HiOutlineDocumentText },
  { href: "/upload", label: "Upload CSV", icon: HiOutlineUpload },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { dbUser, appRole, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <aside className="w-64 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-r border-gray-200/60 dark:border-gray-800/60 flex flex-col min-h-screen">
      <div className="p-6 border-b border-gray-200/60 dark:border-gray-800/60">
        <h1 className="text-xl font-bold gradient-text tracking-tight">
          Mimimomentum
        </h1>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Execution + Review</p>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800/60"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "text-indigo-500" : ""}`} />
              {item.label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />}
            </Link>
          );
        })}

        {/* Let's Meet — goes to meet page which opens Zoom with locked name */}
        {dbUser && (
          <Link
            href="/meet"
            className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-xl text-sm font-medium transition-all duration-200 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 text-blue-600 dark:text-blue-400 hover:from-blue-500/20 hover:to-cyan-500/20"
          >
            <HiOutlineVideoCamera className="w-5 h-5" />
            Let&apos;s Meet
          </Link>
        )}
      </nav>

      <div className="p-3 border-t border-gray-200/60 dark:border-gray-800/60 space-y-1">
        <button onClick={toggle}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all w-full rounded-xl hover:bg-gray-100/80 dark:hover:bg-gray-800/60">
          {theme === "dark" ? <HiOutlineSun className="w-4 h-4 text-yellow-500" /> : <HiOutlineMoon className="w-4 h-4 text-indigo-400" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>

        {dbUser && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                {dbUser.full_name?.[0] || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{dbUser.full_name}</p>
                <p className="text-[10px] text-gray-400 truncate">{dbUser.email}</p>
                <span className={`inline-block mt-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[appRole]}`}>{ROLE_LABELS[appRole]}</span>
              </div>
            </div>
          </div>
        )}

        <button onClick={signOut}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all w-full rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10">
          <HiOutlineLogout className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
