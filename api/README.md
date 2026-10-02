# SM ERP API — Auth & RBAC

Express 5 + PostgreSQL backend: JWT login, refresh-token rotation, role-based access control
and the first protected finance endpoint.

## Setup

```bash
npm install
cp .env.example .env          # set DATABASE_URL and a long random JWT_ACCESS_SECRET
npm run migrate               # applies db/migrations/*.sql once each (tracked in schema_migrations)
npm run dev
```

Requires Node 22 and PostgreSQL 15+. Redis is optional (shared cache and rate limits).

## Layout

```
src/
  app.js                 express app: helmet, CORS allowlist, JSON limit, error handling
  server.js              listen + graceful shutdown
  config/env.js          env validated with zod at boot (bad config = no start)
  config/roles.js        role constants (mirror the DB enum)
  db/pool.js             pg pool + withTransaction()
  errors/AppError.js     typed client-facing errors
  middleware/
    authenticate.js      Bearer JWT -> req.auth (re-checked against DB every request)
    authorize.js         authorize(...roles) — RBAC
    scope.js             resolveBranchScope() — which tenant/branch rows a caller may see
    validate.js          zod validation -> req.valid
    rateLimit.js         per-IP limits on login / refresh
    errorHandler.js      one error shape for every failure
  modules/auth/          login, refresh, logout, logout-all, me
  modules/finance/       GET /finance/defaulters
  modules/payments/      Razorpay create-order, webhook, receipt PDF
  modules/documents/     report cards, Transfer Certificate, Bonafide, QR verification
    report-card.calculator.js   pure CBSE maths (components, grades, ranks, attendance)
    pdf/kit.js                  reusable pdfkit blocks: letterhead, tables, signatures, watermark, QR footer
    pdf/report-card.pdf.js      report card layout
    pdf/certificate.pdf.js      TC + bonafide layouts
db/migrations/           001 foundation, 002 fees & academics, 003 refresh tokens
```

## Endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/auth/login` | public (rate limited) |
| POST | `/api/v1/auth/refresh` | refresh token (cookie or body) |
| POST | `/api/v1/auth/logout` | refresh token |
| POST | `/api/v1/auth/logout-all` | any signed-in user |
| GET | `/api/v1/auth/me` | any signed-in user |
| GET | `/api/v1/finance/defaulters` | `super_admin`, `branch_admin` |
| GET | `/api/v1/fees/students` | `super_admin`, `branch_admin` |
| GET | `/api/v1/fees/students/:studentId/dues` | `super_admin`, `branch_admin` |
| POST | `/api/v1/fees/invoices` | `super_admin`, `branch_admin` |
| GET | `/api/v1/fees/invoices/:invoiceId` | `super_admin`, `branch_admin` |
| POST | `/api/v1/fees/payments` (needs `Idempotency-Key` header) | `super_admin`, `branch_admin` |
| GET | `/api/v1/fees/analytics` | `super_admin`, `branch_admin` |
| GET | `/api/v1/academics/sections` | `teacher` (own class), `branch_admin`, `super_admin` |
| GET | `/api/v1/academics/attendance?sectionId=&date=` | `teacher` (own class), `branch_admin`, `super_admin` |
| POST | `/api/v1/academics/attendance` | `teacher` (own class), `branch_admin`, `super_admin` |
| GET | `/api/v1/academics/attendance/notifications?sectionId=&date=` | `teacher` (own class), `branch_admin`, `super_admin` |
| POST | `/api/v1/notifications/broadcasts` | `super_admin`, `branch_admin` |
| POST | `/api/v1/notifications/fee-reminders/run` | `super_admin`, `branch_admin` |
| GET | `/api/v1/notifications/batches/:batchId` | `super_admin`, `branch_admin` |
| GET | `/api/v1/notifications/logs?status=failed` | `super_admin`, `branch_admin` |
| POST | `/api/v1/notifications/logs/:id/retry` | `super_admin`, `branch_admin` |
| POST | `/api/v1/finance/create-order` (optional `Idempotency-Key`) | `parent` (own child), `branch_admin`, `super_admin` |
| GET | `/api/v1/finance/orders/:orderId` | `parent` (own child), `branch_admin`, `super_admin` |
| GET | `/api/v1/finance/receipts/:receiptId/pdf` (`?download=1`) | `parent` (own child), `branch_admin`, `super_admin` |
| POST | `/api/v1/finance/webhook` | Razorpay only (HMAC signature, no JWT) |
| POST | `/api/v1/documents/report-cards/generate` `{sectionId, termId?}` | class teacher, `branch_admin`, `super_admin` |
| POST | `/api/v1/documents/report-cards/publish` `{sectionId, termId?}` | `branch_admin`, `super_admin` |
| PATCH | `/api/v1/documents/report-cards/:id` (remarks; result = admin only) | class teacher, admins |
| GET | `/api/v1/documents/report-cards/:id/pdf` | admins, class teacher; parent/student once published |
| GET | `/api/v1/documents/students/:studentId/report-cards` | admins; parent/student (published only) |
| POST | `/api/v1/documents/students/:studentId/transfer-certificate` | `branch_admin`, `super_admin` |
| POST | `/api/v1/documents/students/:studentId/bonafide` `{purpose}` | `branch_admin`, `super_admin` |
| GET | `/api/v1/documents/certificates?studentId=&type=` | `branch_admin`, `super_admin` |
| GET | `/api/v1/documents/certificates/:id/pdf?copy=original\|duplicate` | `branch_admin`, `super_admin` |
| POST | `/api/v1/documents/certificates/:id/cancel` `{reason}` | `branch_admin`, `super_admin` |
| GET | `/api/v1/verify/:code` | public (rate limited) — what the QR code opens |

Login body: `{ "tenantCode": "dps", "identifier": "email or username", "password": "...", "client": "web" | "mobile" }`
(omit `tenantCode` for platform super admins).

Errors always look like:

```json
{ "error": { "code": "INSUFFICIENT_ROLE", "message": "...", "requestId": "...", "details": {} } }
```

## Protecting a new route

```js
router.get(
  '/attendance/section/:sectionId',
  authenticate,
  authorize(ROLES.TEACHER, ROLES.BRANCH_ADMIN),
  validate({ params: schema }),
  handler,
);
```

`authorize` decides whether a role may call the endpoint; `resolveBranchScope` (or an
equivalent check) decides whose rows it may see. Use both on anything branch-scoped.

## Fee management

How money flows:

1. **Allocations** (`student_fee_allocations`) say what a student owes: copied from the class fee
   structure, with any concession.
2. **Invoices** bill allocations. `POST /fees/invoices` with just `studentId` bills every unbilled
   allocation; `billUpTo` limits it to installments due by a date; `allocationIds` picks exact ones;
   `items` adds one-off charges. An allocation can only ever be billed once (DB-enforced).
3. **Payments** settle invoices. `POST /fees/payments` issues one receipt and applies the amount to
   the selected open invoices oldest-due first. Overpayment is refused. Invoice totals, paid amount
   and status are maintained by database triggers, never by the app.

Invoice and receipt numbers are gap-free per branch and year, e.g. `DWARKA/RCT/2026-27/00042`.

`POST /fees/payments` requires an `Idempotency-Key` header (8–100 chars). The client generates one
per payment attempt and reuses it on retry: a repeated request, even five concurrent ones, returns
the original receipt (`200`, `Idempotent-Replayed: true`) instead of charging again.

Money crosses the API as decimal strings in rupees (`"4500.50"`), is handled as integer paise
inside the service, and is stored as `numeric(12,2)`.

Cheques are recorded as received immediately. Handle a bounced cheque with a refund transaction.

## Attendance and parent notifications

`POST /academics/attendance` takes the whole register for one section and day:

```json
{ "sectionId": "…", "date": "2026-10-02", "records": [{ "studentId": "…", "status": "absent" }] }
```

- `date` defaults to today in the school's timezone. Teachers can record today and yesterday;
  admins up to 30 days back (`BACKDATE_DAYS` in `attendance.service.js`). Future dates and dates
  outside the academic year are refused.
- Teachers can only mark sections where they are the class teacher.
- The register must list every enrolled student exactly once; otherwise `422 ROSTER_INCOMPLETE`
  or `STUDENT_NOT_IN_SECTION`. Re-submitting updates the marks (`200`, `revision` goes up).
- Parent messages are written to `parent_notifications` in the same transaction (an outbox), so
  a failed save never messages anyone. Only changes trigger messages:
  - newly absent → absence SMS (or email if the parent has no phone) to each parent/guardian
    who receives notices;
  - absent → present before the message went out → message cancelled;
  - absent → present after it went out → correction message.
  Re-submitting the same register sends nothing new.

`src/modules/notifications/dispatcher.js` delivers queued messages. It starts with the server,
claims rows with `FOR UPDATE SKIP LOCKED` (safe with several API instances), retries failures
three times with backoff, and recovers rows a crashed process left half-sent. The provider is
**simulated**: it logs the masked recipient and text. Replace `simulatedProvider` with a real
gateway (MSG91, Gupshup, Twilio, …) that implements `send({ channel, recipient, message })`.

## Notification service (WhatsApp / SMS)

`src/modules/notifications/NotificationService.js` is the communication engine:

```js
import { getNotifier } from './modules/notifications/index.js';
const notifier = getNotifier({ env, logger });

await notifier.sendAbsenteeAlert('98110 42231', 'Aarav Sharma', '2026-10-02', { tenantId, studentId });
await notifier.sendFeeDueReminder(phone, 'Ravi Sharma', 39000, '2026-10-10', 'https://app.example/parent/fees?child=…');
await notifier.sendBroadcastNotice('teacher', 'Staff meeting', 'Today 3:30 pm, AV room', { tenantId, branchId });
```

**Gateways.** WhatsApp through WATI (`NOTIFY_WHATSAPP_PROVIDER=wati`) or Twilio; SMS through MSG91
or Twilio; `simulated` logs instead of sending (the default). WhatsApp is tried first; if the
parent is not on WhatsApp or the template is missing, SMS is used.

**Never throws for delivery problems.** Every call returns `{ ok: true, channel, provider,
providerMessageId, attempts, logId }` or `{ ok: false, error: { code, message, retryable }, logId }`.

**notification_logs (migration 006).** Each dispatch writes a row *before* calling the gateway
(`sending`), then updates it to `sent`, `failed` or `abandoned` with the gateway, channel, HTTP
status, error code and attempt count. The stored template variables are enough to re-send.

- Transient errors (timeout, network, 429, 5xx) are retried in-process with backoff and jitter.
  If they still fail, the row gets `next_retry_at` and the **retry worker** (started with the
  server, every `NOTIFY_RETRY_INTERVAL_MS`) re-sends it after 5 min, 30 min, 2 h and 6 h, then
  marks it `abandoned`. It claims rows with `FOR UPDATE SKIP LOCKED`, so several instances are
  safe, and it recovers rows left in `sending` by a crash.
- Permanent errors (invalid number, opted out, rejected by the gateway) are logged as `failed`
  with no retry time; fix the data, then `POST /notifications/logs/:id/retry`.
- `dedupeKey` makes a send idempotent: fee reminders use one key per student, parent and day,
  so re-running the job never messages a parent twice.
- If the log table can't be written, the message is still sent and the error goes to the app log.
- Attendance absence/correction alerts are logged too (`max_retries = 0`, because the attendance
  outbox already retries them).

**The three messages**

1. **Absentee alert:** sent the moment a teacher submits attendance (outbox, then dispatcher,
   then this service), to every parent/guardian with notices on.
2. **Fee due reminder (split dues):** `jobs/fee-reminders.job.js` finds students with open
   installments that are overdue or due within `daysAhead`, adds up the open balance across those
   installments, and sends one reminder per parent with the earliest due date and a link to
   `PARENT_PORTAL_URL/parent/fees?child=…`. Run it from the admin endpoint, or daily from a
   scheduler: `npm run job:fee-reminders` (e.g. a Railway cron service at 09:00 IST).
3. **Broadcast notice:** `POST /notifications/broadcasts` with `targetRole` `teacher` or `parent`.
   Branch admins reach only their branch; super admins their whole school group. It answers
   `202` with a `batchId` straight away and sends in the background; poll
   `GET /notifications/batches/:batchId` for progress.

**India rules.** SMS text must match the DLT-registered template and go out from your 6-character
sender ID; SMS uses "Rs." because "₹" makes the SMS Unicode (70 instead of 160 characters per
segment). WhatsApp business-initiated messages must use Meta-approved templates: on WATI the
template names and their named parameters are in `providers/wati.provider.js`
(`DEFAULT_WATI_TEMPLATES`, overridable with `WATI_TEMPLATE_*`).

**Personal data.** `notification_logs.recipient_phone` holds full numbers (retries need them).
Keep access to admins and purge old rows, for example nightly:
`DELETE FROM notification_logs WHERE created_at < now() - interval '180 days';`

`NOTIFY_SIMULATED_FAIL_ALWAYS` / `NOTIFY_SIMULATED_FAIL_TRANSIENT` only affect the simulated
provider and exist to rehearse failures in development.

Tests: `npm test` (fake Twilio, MSG91 and WATI servers, in-memory log store).

## Online fee payment (Razorpay)

```
Parent app ──POST /finance/create-order {invoiceIds, amount?}──▶ API ──POST /v1/orders──▶ Razorpay
           ◀── checkout options (key, order_id, amount in paise) ──
Parent pays in Razorpay Checkout (UPI / card / net banking)
Razorpay ──POST /finance/webhook  payment.captured (signed)──▶ API  ── ONE DB transaction ──▶
           event row → lock order → lock student + invoices → fee_receipts → fee_transactions
           (trigger sets invoice Paid / Partially Paid) → order paid → COMMIT → 200
Parent app polls GET /finance/orders/:id → paid + receipt → GET /finance/receipts/:id/pdf
```

**Nothing is marked paid from the browser.** Only the signed webhook posts to the ledger.

Duplicate protection (network timeouts, retries, parallel deliveries):

1. `payment_webhook_events` is unique on Razorpay's `x-razorpay-event-id`. A re-delivered
   event returns `200 duplicate` and does nothing.
2. The order row is locked `FOR UPDATE`. `payment.captured` and `order.paid` for the same
   payment, arriving together, queue on it; the second sees `already_paid`.
3. `fee_receipts.idempotency_key = rzp:<payment_id>` and the unique
   `(gateway, gateway_payment_id, invoice_id)` index on `fee_transactions` stop a double post
   even if the first two layers were bypassed.
4. If anything fails mid-way the whole transaction rolls back (including the receipt number,
   so no gaps) and the API returns 5xx, so Razorpay retries cleanly.

Money that can't be applied is never forced onto an invoice. The order goes to `needs_review`
with a reason, for the office to refund or adjust:

- a cashier collected part of the same invoice while the parent was paying (the excess);
- a second payment captured on an already settled order;
- a captured amount or currency that doesn't match the order.

Find them with:

```sql
SELECT * FROM payment_orders WHERE status = 'needs_review';
SELECT * FROM payment_webhook_events WHERE outcome IN ('needs_review', 'unknown_order');
```

Setup:

1. Razorpay Dashboard → API Keys → set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Dashboard → Webhooks → Add: URL `https://<api-host>/api/v1/finance/webhook`, events
   `payment.captured` and `order.paid`, and a secret. Put that secret in `RAZORPAY_WEBHOOK_SECRET`.
   It is not the key secret.
3. Use `rzp_test_` keys until the flow is checked; the API refuses a test key when
   `NODE_ENV=production`.

The receipt PDF (A4, pdfkit) is rendered on request from the receipt row created in the
webhook transaction, so it always matches the ledger and nothing has to be stored. It also works
for counter receipts. The client side is in `sm-erp-web/src/features/parent/razorpay-checkout.ts`
(`payFees()` and `openReceipt()`).

## Official documents (report cards, TC, bonafide)

**Report cards** follow the CBSE classes VI–VIII structure (Circular Acad-14/2017): each term =
Periodic Test 10 (average of best two) + Notebook 5 + Subject Enrichment 5 + Half-Yearly/Yearly 80,
graded A1…E; co-scholastic areas and Discipline on A/B/C. Classes IX–X default to the annual
20 + 80 scheme. Weights live in `SCHEMES` in `report-card.calculator.js`.

Setup the school needs:

- `academic_terms` for the year, and `exams.component_code` on each exam: `PT`, `NB`, `SEA`, `MA`, `PF` or `TERM`.
  Exams without a code, or still in `draft`, are ignored.
- Co-scholastic areas = subjects with `is_graded_only = true` (grade in `marks_entry.grade` on the term exam);
  the subject with code `DISC` is printed as Discipline.
- Optional branch settings `settings.documents`: `principalName`, `website`, `logo` (data URI),
  `secondaryLogo`, `scheme` (`cbse_6_8` / `cbse_9_10`), `showRanks` (default true), `board`, `place`.
- `classes.numeric_level` (for "Promoted to Class VI" and class in words).

Flow: generate (teacher or admin) → teacher adds remarks → admin publishes → parents can download.
Generation computes the whole class (ranks span sections), stores a frozen snapshot in
`report_cards.snapshot`, and never touches a published card. Ties share a rank; a student with a
missing term exam gets no rank and result "pending". The admin can override the result; the
override survives regeneration.

Note: CBSE stopped publishing merit lists for board results in 2023 to avoid unhealthy
competition. Ranks are on by default here because you asked for them; set `showRanks: false` to hide them.

**Transfer Certificate** prints the 23 fields of the CBSE TC format, mostly derived from records:
date of birth in words, class at admission, class last studied in words, last annual result,
times failed in the class, subjects studied, dues paid up to, concessions and attendance. The office
supplies the date of application, reason for leaving, conduct, NCC/Scouts and activities.
Issuing a TC:

- refuses if the admission record is incomplete (father/guardian name, mother's name, nationality, category);
- warns with `409 DUES_OUTSTANDING` until the office confirms with `acknowledgeDues: true`, and then
  records the dues on the TC;
- allows only one valid TC per student;
- takes a gap-free number (`DWARKA/TC/2026-27/0001`) and marks the student `transferred`.

**Bonafide** needs only a purpose and an enrolled student.

**Authentication**: every certificate is frozen in `certificates.content` with a SHA-256; a trigger
blocks edits, so every reprint is identical. The first print says ORIGINAL; later prints are
watermarked DUPLICATE. Each document carries a QR code + code (`XXXX-XXXX-XXXX`) pointing to
`DOCUMENT_VERIFY_BASE_URL/<code>`. Your web page there calls `GET /api/v1/verify/:code`, which shows
valid / cancelled. Cancelling a TC keeps it in the register, marks prints CANCELLED, and frees the
student for a corrected TC. Signature lines (Prepared by, Checked by, Principal + seal; Class
Teacher, Principal, Parent on report cards) are left blank for wet signatures.

## Production on Railway

Files: `Dockerfile` (multi-stage, prod dependencies only, non-root, tini as PID 1,
`NODE_ENV=production`), `.dockerignore`, `../.railway/railway.ts` (infrastructure as code, at the repo root) and
`scripts/migrate.js` (the pre-deploy step).

Why there's no `railway.json`: Railway has deprecated Config as Code. New services can't use it,
and Railway stops reading `railway.json` / `railway.toml` on **2026-12-01**. `.railway/railway.ts` is
the replacement. Railway does not read it on deploy; you apply it with the CLI:

```bash
railway login && railway link      # project: school-erp, environment: production
npm run railway:plan               # read-only diff (run at the repo root)
railway config apply               # asks before changing anything
```

It declares the `api` service (Dockerfile build, `node scripts/migrate.js` pre-deploy, healthcheck
`/health/ready`, restart on failure, 15 s draining, 2 replicas in production), Postgres and Redis.
All three are in Singapore (`asia-southeast1-eqsg3a`). Variables reference the databases over the
private network (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`). Secrets are `preserve()`d:
create them in the dashboard as sealed variables first:

`JWT_ACCESS_SECRET`, `CORS_ORIGINS`, `PARENT_PORTAL_URL`, `DOCUMENT_VERIFY_BASE_URL`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

Both services deploy from the GitHub repo `kameriyaharman/sm-erp` (root directories `/api` and `/web`). The API has no public domain: the web service proxies `/api/v1/*` to it over the private network, which also keeps the refresh cookie first-party. Hence `TRUST_PROXY=2` (Railway edge + web proxy).

**Production guards** (the process exits with one JSON log line naming the bad variables, never their values):
- `NODE_ENV` must be `production` in Railway's production environment.
- CORS origins must be https and not localhost.
- The simulated SMS/WhatsApp provider is refused; use a real one or `none`.
- `DOCUMENT_VERIFY_BASE_URL` (printed in certificate QR codes) must be https.
- A public database host requires `DATABASE_SSL`.
- `JWT_ACCESS_SECRET` must be at least 48 characters.

**Database pool**:
- `DB_POOL_MAX` connections per replica. Keep replicas × pool + migrations/cron/psql well under Postgres' 100.
- Each connection gets `statement_timeout` (15 s), `lock_timeout` and `idle_in_transaction_session_timeout`.
- Connections are recycled every 30 minutes.
- A query timeout returns 503 `QUERY_TIMEOUT`, and an exhausted pool returns 503 `SERVICE_BUSY` instead of hanging.

**Cache** (`middleware/cache.js`, `cache/`):
- Redis when `REDIS_URL` is set, otherwise an in-process LRU.
- Cached: fee ledger 60 s, fee analytics 5 min, defaulters 2 min, teacher's sections 30 s.
- Keys include the caller's scope: admins of the same branch share entries; other roles are keyed per user.
- Invoices, counter payments, online payments (webhook) and attendance submissions invalidate their
  namespace before the response returns, using a version bump per tenant, with no key scans.
- Dues shown before collecting money are never cached.
- If Redis goes down, requests carry on with the memory cache and reconnect on their own.

**Rate limits** (`middleware/rateLimit.js`):
- Login: failed attempts per IP (30 / 15 min) and per account across IPs (10 / 15 min), on top of
  the DB lockout. Successful logins don't count, so a school's shared Wi-Fi isn't blocked.
- Refresh 60 / 15 min, logout 30 / 15 min, public verify 60 / 15 min.
- Whole API: 1200 / min per IP. PDFs: 30 / min per user.
- IPv6 is grouped per /56. Counters are shared in Redis.
- If Redis is down, limits fall back to per-replica memory; they never switch off.
- `TRUST_PROXY=1` makes `req.ip` the real client behind Railway's proxy.
- There is no public `/register`: accounts are created by administrators.

**Logs**:
- One JSON line per event on stdout/stderr, which Railway parses.
- `level` and `message`, plus `service`/`deployment`/`replica` and filterable fields such as
  `@requestId`, `@userId`, `@status`.
- One access-log line per request: path without query string, status, duration, cache hit/miss.
- Health checks are not logged.
- Keys that look like secrets are redacted.

**Health**: `/health/live` (process only) and `/health/ready` (DB; reports Redis as ok/degraded/disabled).

**Shutdown**: on SIGTERM the server stops accepting connections, drains, closes Postgres and Redis,
and exits 0 (forced after 10 s). Notification workers claim rows with `FOR UPDATE SKIP LOCKED`, so
running several replicas is safe.

## Security notes

- Access tokens: HS256 pinned, 15 min, issuer/audience checked. Role, tenant and branch are
  read from the DB on every request, so suspensions, demotions and password changes apply
  immediately.
- Refresh tokens: opaque, stored as SHA-256 only, rotated on every use. Replaying a used token
  revokes that whole device session.
- Web clients get the refresh token only as an `httpOnly; SameSite=Strict` cookie scoped to
  `/api/v1/auth`; mobile clients receive it in the body for Keychain/Keystore storage.
- Accounts lock after `MAX_FAILED_LOGINS` failures for `LOCKOUT_MINUTES`; unknown users and
  wrong passwords return the same error in the same time.
- Login by phone is intentionally not supported: phone numbers are not unique.
- The rate limiter is in-memory. With more than one API instance, switch it to a shared store
  (e.g. Redis).
