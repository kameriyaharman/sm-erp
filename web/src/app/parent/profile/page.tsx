'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LogOut } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import { currentUser, logout } from '@/lib/session';

function Profile() {
  const router = useRouter();
  const user = currentUser();
  return (
    <main className="mx-auto max-w-md px-5 py-6">
      <Link href="/parent" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 dark:text-stone-300">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Home
      </Link>
      <h1 className="mt-6 text-xl font-semibold">{[user?.firstName, user?.lastName].filter(Boolean).join(' ')}</h1>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{user?.email ?? user?.username}</p>
      <button
        type="button"
        onClick={async () => {
          await logout();
          router.replace('/login');
        }}
        className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-300 text-[15px] font-medium dark:border-stone-700"
      >
        <LogOut className="h-4 w-4" aria-hidden /> Sign out
      </button>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Profile />
    </RequireAuth>
  );
}
