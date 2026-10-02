import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SM ERP', template: '%s · SM ERP' },
  description: 'School management: fees, attendance, report cards and the parent app.',
  applicationName: 'SM ERP',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0E1A33' },
    { media: '(prefers-color-scheme: dark)', color: '#0A1121' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
