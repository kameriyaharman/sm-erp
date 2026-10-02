import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import RegisterServiceWorker from '@/features/parent/RegisterServiceWorker';

export const metadata: Metadata = {
  title: 'SM ERP Parent',
  description: 'Fees, attendance, homework, timetable and school bus for your children.',
  manifest: '/parent.webmanifest',
  appleWebApp: { capable: true, title: 'School', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets env(safe-area-inset-*) work under the notch / home indicator
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0a09' },
  ],
};

export default function ParentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <RegisterServiceWorker />
    </>
  );
}
