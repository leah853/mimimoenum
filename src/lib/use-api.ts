"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ── Request deduplication cache ──────────────────────────────────────
// Same-URL fetches within DEDUP_TTL_MS share one promise, eliminating
// redundant calls when multiple components mount simultaneously.
const DEDUP_TTL_MS = 2000;
const inflightCache = new Map<string, { promise: Promise<unknown>; ts: number }>();

function dedupFetch<T>(url: string): Promise<T> {
  const now = Date.now();
  const cached = inflightCache.get(url);
  if (cached && now - cached.ts < DEDUP_TTL_MS) return cached.promise as Promise<T>;

  const promise = fetch(url).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  });

  inflightCache.set(url, { promise, ts: now });
  // Auto-cleanup after TTL
  setTimeout(() => inflightCache.delete(url), DEDUP_TTL_MS);
  return promise as Promise<T>;
}

/** Invalidate dedup cache for URLs matching a pattern. Call after mutations
 *  that affect shared data (e.g. after acknowledging feedback, clear /api/tasks and /api/stats). */
export function invalidateCache(...patterns: string[]) {
  for (const key of inflightCache.keys()) {
    if (patterns.length === 0 || patterns.some(p => key.includes(p))) {
      inflightCache.delete(key);
    }
  }
}

// ── useApi hook ──────────────────────────────────────────────────────
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);

  const refetch = useCallback(async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // Bypass dedup cache on explicit refetch — user wants fresh data
      inflightCache.delete(currentUrl);
      const json = await dedupFetch<T>(currentUrl);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    urlRef.current = url;
    if (url) {
      setData(null);
      // Use dedup for initial mount fetches (parallel components share one request)
      dedupFetch<T>(url)
        .then((json) => setData(json))
        .catch((e) => setError(e instanceof Error ? e.message : "Unknown error"))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [url]);

  return { data, loading, error, refetch, setData };
}

// ── Mutation helpers ─────────────────────────────────────────────────
export async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function apiPatch(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function apiDelete(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function apiUpload(url: string, formData: FormData) {
  const res = await fetch(url, { method: "POST", body: formData });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
