'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './session';

/**
 * Loads `path` with the signed-in user's token. Pass null to wait (e.g. until a filter is chosen).
 * Returns { data, error, loading, reload }. Re-fetches when the path changes; stale responses are dropped.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<T>(path);
      if (mine === seq.current) setData(result);
    } catch (err) {
      if (mine === seq.current) setError((err as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Builds "?a=1&b=2", skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const text = sp.toString();
  return text ? `?${text}` : '';
}
