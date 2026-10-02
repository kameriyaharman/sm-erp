'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, LogOut, Phone } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import { currentUser, logout } from '@/lib/session';
import { Avatar, PCard, ParentScreen, SectionTitle, secondaryBtn } from '@/features/parent/ParentLayout';
import { displayPhone, telHref } from '@/features/parent/format';

function SignOut() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      type="button"
      disabled={leaving}
      onClick={async () => {
        setLeaving(true);
        try {
          sessionStorage.removeItem('sm_parent_child');
        } catch {
          /* ignore */
        }
        await logout();
        router.replace('/login');
      }}
      className={`${secondaryBtn} h-11 w-full text-[15px]`}
    >
      {leaving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />} Sign out
    </button>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Suspense>
        <ParentScreen active="profile" title="Profile" hideSwitcher>
          {({ data }) => {
            const user = currentUser();
            const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || data.parentName;
            return (
              <>
                <PCard className="flex items-center gap-4 p-5" aria-label="Your account">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0b6b78] text-xl font-bold text-white dark:bg-[#5cc0cc] dark:text-stone-950" aria-hidden>
                    {name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{name}</p>
                    <p className="truncate text-sm text-stone-500 dark:text-stone-400">{user?.email ?? user?.username}</p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">Parent · {data.schoolName}</p>
                  </div>
                </PCard>

                <section aria-labelledby="kids">
                  <SectionTitle id="kids">Your children</SectionTitle>
                  <ul className="flex flex-col gap-3">
                    {data.children.map(({ child }) => (
                      <PCard as="li" key={child.id} className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={child.name} selected />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-semibold">{child.name}</p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              {child.className} {child.sectionName}
                              {child.rollNumber ? ` · Roll no. ${child.rollNumber}` : ''}
                            </p>
                          </div>
                        </div>
                        {child.classTeacher && (
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5 text-sm dark:bg-stone-950/60">
                            <span className="min-w-0">
                              <span className="block text-xs text-stone-500 dark:text-stone-400">Class teacher</span>
                              <span className="block truncate font-semibold">{child.classTeacher.name}</span>
                            </span>
                            {child.classTeacher.phone && (
                              <a
                                href={telHref(child.classTeacher.phone)}
                                aria-label={`Call ${child.classTeacher.name}, ${displayPhone(child.classTeacher.phone)}`}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[#0b6b78] ring-1 ring-inset ring-[#0b6b78]/30 hover:bg-[#e3f1f2] dark:text-[#7dd0da] dark:ring-[#5cc0cc]/30 dark:hover:bg-[#0b6b78]/20"
                              >
                                <Phone className="h-4 w-4" aria-hidden /> Call
                              </a>
                            )}
                          </div>
                        )}
                      </PCard>
                    ))}
                  </ul>
                </section>

                {data.schoolPhone && (
                  <a href={telHref(data.schoolPhone)} className={`${secondaryBtn} h-11 w-full text-[15px]`}>
                    <Phone className="h-4 w-4" aria-hidden /> Call the school office ({data.schoolPhone})
                  </a>
                )}
                <SignOut />
              </>
            );
          }}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
