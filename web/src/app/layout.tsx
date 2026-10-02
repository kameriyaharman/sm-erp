import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SM ERP', template: '%s · SM ERP' },
  description: 'School management: fees, attendance, report cards and the parent app.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
