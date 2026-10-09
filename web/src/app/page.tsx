'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { currentUser, getAccessToken, homeFor } from '@/lib/session';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    getAccessToken().then((token) => {
      const user = token ? currentUser() : null;
      router.replace(user ? homeFor(user.role, user.tenantId) : '/login');
    });
  }, [router]);
  return null;
}
