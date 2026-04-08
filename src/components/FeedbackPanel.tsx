"use client";

import { useState } from "react";
import type { Feedback, FeedbackTag } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";

interface FeedbackPanelProps {
  feedback: Feedback[];
  taskId: string;
  onAdded: () => void;
}

export default function FeedbackPanel({ feedback: initialFeedback, taskId, onAdded }: FeedbackPanelProps) {
  const { dbUser } = useAuth();
  const [feedbackList, setFeedbackList] = useState<Feedback[]>(initialFeedback);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [tag, setTag] = useState<FeedbackTag>("approved");
  const [submitting, setSubmitting] = useState(false);

  const canGiveFeedback = dbUser?.role === "mimimomentum" || dbUser?.role === "admin";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dbUser) return;
    setSubmitting(true);

    const newFeedback: Feedback = {
      id: `fb-${Date.now()}`,
      task_id: taskId,
      reviewer_id: dbUser.id,
      rating,
      comment: comment || undefined,
      tag,
      created_at: "2026-04-06T00:00:00Z",
      reviewer: { id: dbUser.id, auth_id: dbUser.auth_id, email: dbUser.email, full_name: dbUser.full_name, role: dbUser.role, created_at: "" },
    };

    setFeedbackList((prev) => [...prev, newFeedback]);
    setComment("");
    setRating(5);
    setSubmitting(false);
    onAdded();
  }

  const tagColors: Record<FeedbackTag, string> = {
    approved: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-400/10",
    needs_improvement: "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-400/10",
    blocked: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-400/10",
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Feedback
      </h3>

      {feedbackList.length === 0 ? (
        <p className="text-sm text-gray-400">No feedback yet</p>
      ) : (
        <div className="space-y-3">
          {feedbackList.map((fb) => (
            <div key={fb.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-white">
                    {fb.reviewer?.full_name || "Reviewer"}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tagColors[fb.tag]}`}>
                    {fb.tag.replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-lg font-bold text-gray-900 dark:text-white">{fb.rating}</span>
                  <span className="text-xs text-gray-500">/10</span>
                </div>
              </div>
              {fb.comment && <p className="text-sm text-gray-600 dark:text-gray-300">{fb.comment}</p>}
            </div>
          ))}
        </div>
      )}

      {canGiveFeedback && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-800">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Rating (1-10)</label>
              <input type="number" min={1} max={10} value={rating} onChange={(e) => setRating(parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Tag</label>
              <select value={tag} onChange={(e) => setTag(e.target.value as FeedbackTag)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm">
                <option value="approved">Approved</option>
                <option value="needs_improvement">Needs Improvement</option>
                <option value="blocked">Obstacle</option>
              </select>
            </div>
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add comment..." rows={2}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm" />
          <button type="submit" disabled={submitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
            {submitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </form>
      )}
    </div>
  );
}
