/**
 * Railway Infrastructure as Code for the SM ERP API.
 *
 * Why not railway.json: Config as Code (railway.json / railway.toml) is deprecated, new
 * services can't opt into it, and Railway stops reading those files on 2026-12-01.
 * This file is the replacement. Railway does not read it during deploys; you preview and
 * apply it with the CLI:
 *
 *   npm i                    # installs the `railway` SDK (devDependency)
 *   railway login && railway link
 *   railway config plan      # read-only diff; review it
 *   railway config apply     # asks for confirmation
 *
 * It is a named partial, so it only manages what it declares (api, Postgres, Redis) and
 * never deletes other services in the project.
 *
 * Secrets are NOT in this file: they are `preserve()`d. Create them in the Railway
 * dashboard first (Variables -> mark as sealed), then plan/apply.
 */
import { defineRailway, postgres, preserve, project, redis, service } from "railway/iac";

export const partial = "sm-erp";

// Singapore is Railway's closest region to India. The API, Postgres and Redis MUST share
// one region: every request makes several DB round trips, and crossing the Pacific adds
// ~170 ms to each. NOTE: the existing Postgres is in US West (sfo); the first plan will
// show it moving. It is empty today, so moving it now costs nothing; once it holds data,
// a region change means a volume migration with downtime.
const REGION = "asia-southeast1-eqsg3a";

export default defineRailway((ctx) => {
  const prod = ctx.environment === "production";

  const db = postgres("Postgres", { region: REGION });
  const cache = redis("Redis", { region: REGION });

  const api = service("api", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      // Migrations run between build and deploy; a failure stops the deploy (old version keeps serving).
      preDeployCommand: ["node scripts/migrate.js"],
      healthcheckPath: "/health/ready",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      // Let in-flight requests finish on redeploy (server.js drains for up to 10 s).
      drainingSeconds: 15,
      sleepApplication: false,
    },
    replicas: { [REGION]: prod ? 2 : 1 },
    env: {
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      LOG_LEVEL: "info",

      // Private network (*.railway.internal): no public exposure, no SSL needed.
      DATABASE_URL: db.env.DATABASE_URL,
      DATABASE_SSL: "disable",
      // 2 replicas x 10 + migrations/cron/psql stays far below Postgres' 100 connections.
      DB_POOL_MAX: "10",
      DB_STATEMENT_TIMEOUT_MS: "15000",
      REDIS_URL: cache.env.REDIS_URL,

      // Secrets and per-deployment URLs: set in the dashboard, kept as-is here.
      JWT_ACCESS_SECRET: preserve(),
      CORS_ORIGINS: preserve(),              // e.g. https://app.yourschool.in,https://parent.yourschool.in
      PARENT_PORTAL_URL: preserve(),
      DOCUMENT_VERIFY_BASE_URL: preserve(),  // e.g. https://app.yourschool.in/verify
      RAZORPAY_KEY_ID: preserve(),
      RAZORPAY_KEY_SECRET: preserve(),
      RAZORPAY_WEBHOOK_SECRET: preserve(),

      // Until an SMS/WhatsApp gateway is configured; "simulated" is refused in production.
      NOTIFY_SMS_PROVIDER: "none",
      NOTIFY_WHATSAPP_PROVIDER: "none",
    },
  });

  return project("school-erp", { resources: [db, cache, api] });
});
