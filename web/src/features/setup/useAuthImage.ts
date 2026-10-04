'use client';

import { useEffect, useState } from 'react';
import { API_BASE, getAccessToken } from '@/lib/session';

/**
 * Loads an image from the API (which needs the Bearer token, so <img src> can't point at it)
 * and returns an object URL. `version` (e.g. updatedAt) refetches after an upload.
 * Returns { url: null } while loading, when there is no path, or on error.
 */
export function useAuthImage(path: string | null | undefined, version?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('signed out');
        const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(String(res.status));
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setUrl(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, version]);
  return { url, failed };
}
