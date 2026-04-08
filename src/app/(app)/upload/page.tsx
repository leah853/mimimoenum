"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

interface UploadResult {
  success: boolean;
  stats?: Record<string, number>;
  logs?: { type: string; message: string }[];
  error?: string;
}

export default function UploadPage() {
  const { dbUser } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  if (dbUser?.role !== "admin") {
    return <div className="p-8"><h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Upload CSV</h1><p className="text-gray-500">Only admins can upload data.</p></div>;
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : "Upload failed" });
    }
    setUploading(false);
  }

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Upload CSV / Excel</h1>
      <p className="text-sm text-gray-500">Columns: quarter, iteration, week, task_name, subtask_name, owner_email, deadline, dependencies, category</p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-4">
        <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-300" />
        <button onClick={handleUpload} disabled={!file || uploading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800 text-white text-sm rounded-lg">
          {uploading ? "Processing..." : "Upload & Parse"}
        </button>
      </div>

      {result && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-4">
          {result.error ? (
            <p className="text-red-500">{result.error}</p>
          ) : (
            <>
              <h3 className="text-sm font-medium text-green-600 dark:text-green-400">Upload Successful</h3>
              {result.stats && (
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(result.stats).map(([key, val]) => (
                    <div key={key} className="text-center">
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{val}</p>
                      <p className="text-xs text-gray-500 capitalize">{key.replace("_", " ")}</p>
                    </div>
                  ))}
                </div>
              )}
              {result.logs && (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {result.logs.map((log, i) => (
                    <p key={i} className={`text-xs ${log.type === "error" ? "text-red-500" : log.type === "warning" ? "text-yellow-500" : "text-gray-500"}`}>
                      [{log.type}] {log.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
