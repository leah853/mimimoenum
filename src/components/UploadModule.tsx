"use client";

import { useState } from "react";
import type { Deliverable } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";

interface UploadModuleProps {
  deliverables: Deliverable[];
  taskId: string;
  onUploaded: () => void;
}

export default function UploadModule({ deliverables, taskId, onUploaded }: UploadModuleProps) {
  const { dbUser } = useAuth();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const canUpload = dbUser?.role === "eonexea" || dbUser?.role === "admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dbUser || !file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("task_id", taskId);
    formData.append("title", title || file.name);
    formData.append("uploaded_by", dbUser.id);

    await fetch("/api/deliverables/upload", {
      method: "POST",
      body: formData,
    });

    setTitle("");
    setFile(null);
    setUploading(false);
    onUploaded();
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Deliverables
      </h3>

      {deliverables.length === 0 ? (
        <p className="text-sm text-gray-500">No deliverables yet</p>
      ) : (
        <div className="space-y-2">
          {deliverables.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3"
            >
              <div>
                <span className="text-sm text-white">{d.title}</span>
                <span className="text-xs text-gray-500 ml-2">v{d.version}</span>
              </div>
              <div className="flex items-center gap-2">
                {d.file_url && (
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Download
                  </a>
                )}
                <span className="text-xs text-gray-500">
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {canUpload && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-gray-800">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="File title"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
          />
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-gray-800 file:text-gray-300"
          />
          <button
            type="submit"
            disabled={uploading || !file}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm rounded-lg"
          >
            {uploading ? "Uploading..." : "Upload File"}
          </button>
        </form>
      )}
    </div>
  );
}
