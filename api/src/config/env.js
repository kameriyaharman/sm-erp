import 'dotenv/config';
import { z } from 'zod';

const csv = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(['disable', 'no-verify', 'verify']).default('disable'),
  // Connections per API process. Keep (replicas x DB_POOL_MAX) + migrations + psql well under the
  // server's max_connections (Railway Postgres default: 100).
  DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  DB_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(0).default(1_800),   // recycle connections every 30 min

  // ---- Cache + shared rate limits. Railway: REDIS_URL=${{Redis.REDIS_URL}}
  REDIS_URL: z.string().url().refine((u) => /^rediss?:\/\//.test(u), 'REDIS_URL must start with redis:// or rediss://').optional(),
  CACHE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(100).default(5_000),          // in-memory fallback only

  // ---- Rate limits (per window; see middleware/rateLimit.js)
  RATE_LIMIT_LOGIN_PER_IP: z.coerce.number().int().min(1).default(30),        // failed logins / 15 min / IP
  RATE_LIMIT_LOGIN_PER_ACCOUNT: z.coerce.number().int().min(1).default(10),   // failed logins / 15 min / account
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(10).default(1200),      // all API calls / min / IP
  RATE_LIMIT_PDF_PER_MIN: z.coerce.number().int().min(1).default(30),         // PDFs / min / user

  // ---- Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ACCESS_LOG: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Set by Railway; used only to refuse a non-production NODE_ENV in the production environment.
  RAILWAY_ENVIRONMENT_NAME: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_ISSUER: z.string().default('sm-erp-api'),
  JWT_AUDIENCE: z.string().default('sm-erp-clients'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),

  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  CORS_ORIGINS: z.string().default('http://localhost:3000').transform(csv),
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),

  // ---- Notifications (SMS / WhatsApp gateways)
  NOTIFY_SMS_PROVIDER: z.enum(['simulated', 'twilio', 'msg91', 'none']).default('simulated'),
  NOTIFY_WHATSAPP_PROVIDER: z.enum(['none', 'wati', 'twilio', 'simulated']).default('none'),
  NOTIFY_CHANNEL_ORDER: z
    .string()
    .default('whatsapp,sms')
    .transform(csv)
    .pipe(z.array(z.enum(['whatsapp', 'sms'])).min(1)),
  NOTIFY_SCHOOL_NAME: z.string().default('School'),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
  NOTIFY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  NOTIFY_RETRY_INTERVAL_MS: z.coerce.number().int().min(5_000).default(60_000),
  // Dev/test only, for the simulated provider: numbers that fail permanently, and "number:times"
  // pairs that fail with a retryable error that many times before succeeding.
  NOTIFY_SIMULATED_FAIL_ALWAYS: z.string().default('').transform(csv),
  NOTIFY_SIMULATED_FAIL_TRANSIENT: z.string().default('').transform(csv),
  // E-mail (platform account; schools can connect their own SMTP under Settings -> Communication)
  NOTIFY_EMAIL_PROVIDER: z.enum(['none', 'smtp', 'simulated']).default('none'),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),           // e.g. no-reply@smerp.in (must be allowed by the SMTP account)
  EMAIL_FROM_NAME: z.string().default('SM ERP'),

  // WhatsApp Cloud API (schools that connect their own Meta number). Base is overridable for tests.
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'e.g. v25.0').default('v25.0'),
  META_GRAPH_BASE: z.string().url().default('https://graph.facebook.com'),

  // In-process scheduler: automatic fee reminders, birthday wishes, device-attendance cut-off.
  // Runs on every replica; scheduled_runs makes each job run once per school per day.
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),

  // New schools created from the platform console.
  DEFAULT_PLAN_CODE: z.string().default('standard'),
  TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),

  // Parent portal base URL, used for payment links in fee reminders.
  PARENT_PORTAL_URL: z.string().url().refine((u) => u.startsWith('https://'), 'PARENT_PORTAL_URL must use https').optional(),

  WATI_API_ENDPOINT: z.string().url().optional(),   // "API Endpoint" from the WATI dashboard (includes tenant ID)
  WATI_ACCESS_TOKEN: z.string().optional(),
  WATI_CHANNEL_NUMBER: z.string().optional(),       // WhatsApp Business number, e.g. 919876543210
  WATI_TEMPLATE_ABSENTEE: z.string().optional(),    // approved template names (defaults in wati.provider.js)
  WATI_TEMPLATE_FEE_DUE: z.string().optional(),
  WATI_TEMPLATE_NOTICE: z.string().optional(),
  WATI_TEMPLATE_ATTENDANCE_CORRECTION: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_CONTENT_SID_ABSENTEE: z.string().optional(),
  TWILIO_CONTENT_SID_FEE_DUE: z.string().optional(),
  TWILIO_CONTENT_SID_NOTICE: z.string().optional(),
  TWILIO_CONTENT_SID_ATTENDANCE_CORRECTION: z.string().optional(),

  // ---- Online payments (Razorpay). Leave unset to disable online payment (503 PAYMENTS_DISABLED).
  RAZORPAY_KEY_ID: z.string().optional(),            // rzp_test_... / rzp_live_... (public, sent to Checkout)
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),    // set in Dashboard -> Webhooks; NOT the key secret
  RAZORPAY_API_BASE: z.string().url().default('https://api.razorpay.com'),
  RAZORPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  PAYMENT_ORDER_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  // Each school's own Razorpay keys (Settings -> Online payments) are encrypted with this key (AES-256-GCM).
  // 32 random bytes, base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  // Optional to boot; required to save or use school gateway keys. Changing it makes saved keys unreadable
  // (schools then re-enter them).
  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32, 'Must be 32 random bytes, base64-encoded')
    .optional(),
  // School codes that may save Razorpay TEST keys in production (test mode, no real money). Default: the demo school.
  PAYMENTS_TEST_TENANTS: z.string().default('demo').transform((v) => csv(v).map((c) => c.toLowerCase())),

  // ---- Official documents: base URL printed in QR codes, e.g. https://app.school.in/verify (the web page
  // calls GET /api/v1/verify/:code). Defaults to the API's own JSON endpoint.
  DOCUMENT_VERIFY_BASE_URL: z.string().url().optional(),

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().length(6, 'MSG91_SENDER_ID must be the 6-character DLT sender ID').optional(),
  MSG91_FLOW_ABSENTEE: z.string().optional(),
  MSG91_FLOW_FEE_DUE: z.string().optional(),
  MSG91_FLOW_NOTICE: z.string().optional(),
  MSG91_FLOW_ATTENDANCE_CORRECTION: z.string().optional(),
}).superRefine((cfg, ctx) => {
  const need = (keys, why) =>
    keys.filter((k) => !cfg[k]).forEach((k) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `Required when ${why}` }));
  const bad = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  // ---------------- production hardening
  if (cfg.RAILWAY_ENVIRONMENT_NAME === 'production' && cfg.NODE_ENV !== 'production') {
    bad('NODE_ENV', 'Must be "production" in the Railway production environment');
  }
  if (cfg.NODE_ENV === 'production') {
    if (cfg.CORS_ORIGINS.length === 0 || cfg.CORS_ORIGINS.some((o) => !o.startsWith('https://') || /localhost|127\.0\.0\.1/.test(o))) {
      bad('CORS_ORIGINS', 'In production list only https:// origins of your web apps (no localhost)');
    }
    if (cfg.NOTIFY_SMS_PROVIDER === 'simulated' || cfg.NOTIFY_WHATSAPP_PROVIDER === 'simulated' || cfg.NOTIFY_EMAIL_PROVIDER === 'simulated') {
      bad('NOTIFY_SMS_PROVIDER', 'The simulated provider drops messages; pick a real provider or "none" in production');
    }
    if (cfg.NOTIFY_SIMULATED_FAIL_ALWAYS.length || cfg.NOTIFY_SIMULATED_FAIL_TRANSIENT.length) {
      bad('NOTIFY_SIMULATED_FAIL_ALWAYS', 'Test-only setting; remove it in production');
    }
    if (!cfg.DOCUMENT_VERIFY_BASE_URL?.startsWith('https://')) {
      bad('DOCUMENT_VERIFY_BASE_URL', 'Required (https) in production: it is printed in the QR code on every certificate');
    }
    const dbHost = (() => { try { return new URL(cfg.DATABASE_URL).hostname; } catch { return ''; } })();
    const privateDb = dbHost.endsWith('.railway.internal') || ['localhost', '127.0.0.1', '::1'].includes(dbHost);
    if (!privateDb && cfg.DATABASE_SSL === 'disable') {
      bad('DATABASE_SSL', 'Database is reached over the public internet: set DATABASE_SSL=verify or no-verify, or use the private DATABASE_URL');
    }
    if (cfg.JWT_ACCESS_SECRET.length < 48) bad('JWT_ACCESS_SECRET', 'Use at least 48 random characters in production');
  }

  if (cfg.NOTIFY_SMS_PROVIDER === 'twilio') {
    need(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], 'NOTIFY_SMS_PROVIDER=twilio');
    if (!cfg.TWILIO_SMS_FROM && !cfg.TWILIO_MESSAGING_SERVICE_SID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TWILIO_SMS_FROM'], message: 'Set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID' });
    }
  }
  if (cfg.NOTIFY_WHATSAPP_PROVIDER === 'twilio') {
    need(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'], 'NOTIFY_WHATSAPP_PROVIDER=twilio');
  }
  if (cfg.NOTIFY_WHATSAPP_PROVIDER === 'wati') {
    need(['WATI_API_ENDPOINT', 'WATI_ACCESS_TOKEN', 'WATI_CHANNEL_NUMBER'], 'NOTIFY_WHATSAPP_PROVIDER=wati');
  }
  const rzp = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  if (rzp.some((k) => cfg[k]) && !rzp.every((k) => cfg[k])) need(rzp, 'any RAZORPAY_* key is set');
  if (cfg.NODE_ENV === 'production' && cfg.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RAZORPAY_KEY_ID'], message: 'Test key in production' });
  }
  if (cfg.NOTIFY_EMAIL_PROVIDER === 'smtp') {
    need(['EMAIL_SMTP_HOST', 'EMAIL_FROM'], 'NOTIFY_EMAIL_PROVIDER=smtp');
  }
  if (cfg.NOTIFY_SMS_PROVIDER === 'msg91') {
    need(['MSG91_AUTH_KEY', 'MSG91_SENDER_ID'], 'NOTIFY_SMS_PROVIDER=msg91');
  }
});

// Treat `KEY=` (empty, as in .env.example) the same as an unset variable.
const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));

if (!parsed.success) {
  // Fail fast at boot: a misconfigured auth service must never start.
  // One JSON line, so Railway shows it as a single error with the failing variable names (never values).
  console.error(JSON.stringify({ level: 'error', message: 'Invalid environment configuration', fields: parsed.error.flatten().fieldErrors }));
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
});
