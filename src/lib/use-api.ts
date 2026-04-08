"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
      const res = await fetch(currentUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
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
      refetch();
    } else {
      setLoading(false);
    }
  }, [url, refetch]);

  return { data, loading, error, refetch, setData };
}

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
