'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, AuthError } from './session';
import { friendlyError } from './access';

/**
 * Loads `path` with the signed-in user's token. Pass null to wait (e.g. until a filter is chosen).
 * Returns { data, error, loading, reload }. Re-fetches when the path changes; stale responses are dropped.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
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
    setErrorCode(null);
    try {
      const result = await apiGet<T>(path);
      if (mine === seq.current) setData(result);
    } catch (err) {
      // 403s get a plain sentence (NOT_ASSIGNED, NOT_CLASS_TEACHER, ...) instead of the raw API message.
      if (mine === seq.current) {
        setError(friendlyError(err));
        setErrorCode(err instanceof AuthError ? err.code : null);
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, errorCode, loading, reload: load, setData };
}

/** Builds "?a=1&b=2", skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const text = sp.toString();
  return text ? `?${text}` : '';
}
