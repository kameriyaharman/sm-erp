/**
 * The browser only ever talks to this web app. Every /api/v1/* call is proxied to the
 * API over Railway's private network, so:
 *  - the refresh-token cookie is first-party (SameSite=Strict works),
 *  - no CORS round trips,
 *  - the API needs no public domain at all (Razorpay's webhook also comes in through here).
 *
 * API_INTERNAL_URL is read at build time (rewrites are compiled into the build), e.g.
 *   http://api.railway.internal:4000
 */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
