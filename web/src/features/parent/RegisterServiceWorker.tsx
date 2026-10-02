'use client';

import { useEffect } from 'react';

/** Registers the parent-portal service worker (production only, so dev reloads stay predictable). */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/parent-sw.js', { scope: '/parent' }).catch(() => {
      // Offline support is an enhancement; the portal works without it.
    });
  }, []);
  return null;
}
