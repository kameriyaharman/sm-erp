#!/usr/bin/env node
/**
 * Fee setup + day book demo data for the demo school (tenant "demo"). Run by
 * scripts/seed-demo-modules.js during `npm run release`; only when SEED_DEMO=true.
 *
 * Works on a fresh database and on the live one where earlier seeds already ran: receipts and
 * expenses are already in the day book (migration 012 back-posts them, triggers post new ones).
 * Idempotent, phase by phase:
 *   phase 1 (fee heads + Grade 7)  skipped when the demo branch has fee head ADM:
 *     Admission fee (one-time), Annual charges, Examination fee, Caution deposit (refundable);
 *     Grade 7 structure for the current year (tuition quarterly, annual charges, exam fee
 *     half-yearly, admission fee), applied to any enrolled Grade 7 students; concession rules
 *     back-filled from concessions already on allocations (the sibling concession).
 *   phase 2 (accounts + day book)  skipped when the demo branch has a manual or transfer entry:
 *     Cash in hand ₹45,000 and SBI current account ₹32,00,000 (reserves carried forward) as of 1 Apr 2026, an HDFC savings
 *     account, manual incomes (admission forms, donation, canteen rent, RTE grant, interest,
 *     diary sales) and cash -> bank deposits, all through the real services.
 */
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import * as feeSetup from '../src/modules/fee-setup/fee-setup.service.js';
import { generateInstallments } from '../src/modules/fee-setup/schedule.helpers.js';
import { toPaise } from '../src/utils/money.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo finance skipped (SEED_DEMO is not "true")');
  process.exit(0);
}

const OPENING_DATE = '2026-04-01';

async function loadDemo() {
  const { rows: [ctx] } = await pool.query(
    `SELECT tn.id AS tenant_id, b.id AS branch_id, ay.id AS year_id, ay.start_date AS year_start,
            (now() AT TIME ZONE tn.timezone)::date AS today,
            (SELECT id FROM users WHERE tenant_id = tn.id AND email = 'admin@demo.school') AS admin_id
       FROM tenants tn
       JOIN branches b ON b.tenant_id = tn.id AND b.deleted_at IS NULL
       LEFT JOIN academic_years ay ON ay.branch_id = b.id AND ay.is_current
      WHERE tn.code = 'demo'
      ORDER BY b.is_head_office DESC
      LIMIT 1`,
  );
  if (!ctx) return null;
  if (!ctx.year_id || !ctx.admin_id) throw new Error('Demo school is incomplete (no current year or admin)');
  return { ...ctx, auth: Object.freeze({ userId: ctx.admin_id, role: 'branch_admin', tenantId: ctx.tenant_id, branchId: ctx.branch_id }) };
}

// =====================================================================
// Phase 1: fee heads, Grade 7 structure, concession rules
// =====================================================================

const NEW_HEADS = [
  // name, code, type, frequency, refundable
  ['Admission fee', 'ADM', 'one_time', undefined, false],
  ['Annual charges', 'ANN', 'recurring', 'annual', false],
  ['Examination fee', 'EXM', 'recurring', 'half_yearly', false],
  ['Caution deposit', 'CAU', 'one_time', undefined, true],
];

async function phaseOne(demo) {
  const { rows: [has] } = await pool.query(`SELECT 1 FROM fee_heads WHERE branch_id = $1 AND code = 'ADM'`, [demo.branch_id]);
  if (has) return null;
  const out = { heads: 0 };
  for (const [name, code, type, defaultFrequency, refundable] of NEW_HEADS) {
    const exists = await pool.query(`SELECT 1 FROM fee_heads WHERE branch_id = $1 AND (code = $2 OR lower(name) = lower($3))`, [demo.branch_id, code, name]);
    if (exists.rowCount) continue;
    await feeSetup.createHead(demo.auth, { name, code, type, defaultFrequency, refundable, optional: false });
    out.heads += 1;
  }

  // Concession rules for concessions already stamped on allocations (fresh install: the sibling one).
  const { rowCount: rules } = await pool.query(
    `INSERT INTO student_fee_concessions (tenant_id, branch_id, student_id, academic_year_id, fee_head_id,
                                          concession_type, concession_value, reason, approved_by_name, approved_by)
     SELECT a.tenant_id, a.branch_id, a.student_id, a.academic_year_id, a.fee_head_id,
            min(a.concession_type::text)::concession_type, min(a.concession_value), COALESCE(min(a.concession_reason), 'Concession'),
            'Principal', $2
       FROM student_fee_allocations a
      WHERE a.branch_id = $1 AND a.is_active AND a.concession_type <> 'none'
      GROUP BY a.tenant_id, a.branch_id, a.student_id, a.academic_year_id, a.fee_head_id
     HAVING count(DISTINCT (a.concession_type, a.concession_value)) = 1
     ON CONFLICT DO NOTHING`,
    [demo.branch_id, demo.admin_id],
  );
  out.concessionRules = rules;

  const { rows: [g7] } = await pool.query(`SELECT id FROM classes WHERE branch_id = $1 AND name = 'Grade 7' AND deleted_at IS NULL`, [demo.branch_id]);
  if (g7) {
    const current = await feeSetup.getStructure(demo.auth, { classId: g7.id });
    if (current.rows.length === 0) {
      const { rows: heads } = await pool.query(`SELECT id, code FROM fee_heads WHERE branch_id = $1 AND status = 'active'`, [demo.branch_id]);
      const head = (code) => heads.find((h) => h.code === code)?.id;
      const rows = [];
      const add = (code, frequency, rupees, dueDay) => {
        if (!head(code)) return;
        for (const r of generateInstallments({ frequency, yearStart: demo.year_start, dueDay, amount: rupees * 100 })) {
          rows.push({ feeHeadId: head(code), frequency, installmentNo: r.installmentNo, label: r.label, amount: r.amount, dueDate: r.dueDate });
        }
      };
      add('TUI', 'quarterly', 18000, 10);
      add('ANN', 'annual', 6500, 15);
      add('EXM', 'half_yearly', 1200, 20);
      add('ADM', 'one_time', 5000, 10);
      const saved = await feeSetup.saveStructure(demo.auth, { classId: g7.id, rows, dryRun: false });
      out.grade7 = { rows: saved.structure.rows.length, annual: saved.structure.totals.annual };
      const preview = await feeSetup.applyPreview(demo.auth, { classId: g7.id });
      if (preview.newAllocations > 0) {
        const applied = await feeSetup.apply(demo.auth, { classId: g7.id });
        out.grade7.allocated = applied.created;
      }
    }
  }
  return out;
}

// =====================================================================
// Phase 2: accounts and the day book
// =====================================================================

/** The latest Mon–Sat on or before `iso`, minus `back` working days. */
function workingDay(iso, back = 0) {
  let d = new Date(`${iso}T00:00:00Z`);
  let left = back;
  for (;;) {
    if (d.getUTCDay() !== 0) {
      if (left === 0) return d.toISOString().slice(0, 10);
      left -= 1;
    }
    d = new Date(d.getTime() - 86_400_000);
  }
}

async function balanceOn(accountId, date) {
  const { rows: [r] } = await pool.query(
    `SELECT (a.opening_balance + COALESCE(sum(CASE WHEN le.direction = 'in' THEN le.amount ELSE -le.amount END), 0))::text AS bal
       FROM accounts a LEFT JOIN ledger_entries le ON le.account_id = a.id AND le.deleted_at IS NULL AND le.entry_date <= $2
      WHERE a.id = $1 GROUP BY a.id`,
    [accountId, date],
  );
  return toPaise(r.bal);
}

async function phaseTwo(demo) {
  const { rows: [has] } = await pool.query(
    `SELECT 1 FROM ledger_entries WHERE branch_id = $1 AND source IN ('manual', 'transfer') LIMIT 1`,
    [demo.branch_id],
  );
  if (has) return null;
  const { auth } = demo;
  const def = async (kind) => (await pool.query(`SELECT ledger_default_account($1, $2, $3, $4::date) AS id`, [demo.tenant_id, demo.branch_id, kind, OPENING_DATE])).rows[0].id;
  const cashId = await def('cash');
  const bankId = await def('bank');
  // Opening balances as of 1 Apr 2026 (or the first entry, if something is older).
  await pool.query(
    `UPDATE accounts a SET opening_balance = $2, opening_date = LEAST($3::date, COALESCE((SELECT min(entry_date) FROM ledger_entries le WHERE le.account_id = a.id), $3::date))
      WHERE a.id = $1`,
    [cashId, '45000.00', OPENING_DATE],
  );
  await pool.query(
    `UPDATE accounts a SET opening_balance = $2, opening_date = LEAST($3::date, COALESCE((SELECT min(entry_date) FROM ledger_entries le WHERE le.account_id = a.id), $3::date)),
            name = 'SBI Current A/c', details = 'State Bank of India, Dwarka Sec-6 · A/c ••4521'
      WHERE a.id = $1 AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.branch_id = a.branch_id AND lower(x.name) = 'sbi current a/c' AND x.id <> a.id)`,
    [bankId, '3200000.00', OPENING_DATE],
  );
  const hdfc =
    (await pool.query(`SELECT id FROM accounts WHERE branch_id = $1 AND lower(name) = 'hdfc savings a/c'`, [demo.branch_id])).rows[0]?.id ??
    (await accounts.createAccount(auth, { name: 'HDFC Savings A/c', type: 'bank', details: 'HDFC Bank, Dwarka Sec-10 · A/c ••8830', openingBalance: 20000000, openingDate: OPENING_DATE, isDefault: false })).id;

  const today = demo.today;
  const incomes = [
    ['2026-04-06', 'admission', 2100000, 'cash', cashId, 'Admission forms sold (42 × ₹500)', 'Front office', null],
    ['2026-05-12', 'donation', 5100000, 'cheque', bankId, 'Donation for the library', 'Rotary Club of Dwarka', 'CHQ 118204'],
    ['2026-06-30', 'interest', 324000, 'bank_transfer', hdfc, 'Savings interest, Apr-Jun', 'HDFC Bank', null],
    ['2026-07-06', 'canteen', 1500000, 'cash', cashId, 'Canteen contractor rent, July', 'Annapurna Caterers', null],
    ['2026-08-18', 'grant', 8400000, 'bank_transfer', bankId, 'RTE fee reimbursement, 2025-26', 'Directorate of Education, Delhi', 'NEFT/DOE/88213'],
    ['2026-09-07', 'canteen', 1500000, 'upi', bankId, 'Canteen contractor rent, September', 'Annapurna Caterers', 'UPI 6261180042'],
    ['2026-09-30', 'interest', 336000, 'bank_transfer', hdfc, 'Savings interest, Jul-Sep', 'HDFC Bank', null],
    [workingDay(today, 1), 'other_income', 235000, 'cash', cashId, 'School diaries and ID cards sold', 'Front office', null],
    [workingDay(today, 0), 'transport', 180000, 'cash', cashId, 'Bus charges for the science museum trip (Grade 6)', 'Class teacher, 6 A', null],
  ].filter((x) => x[0] <= today);
  let entries = 0;
  for (const [date, category, amount, paymentMode, accountId, description, party, reference] of incomes) {
    await accounts.createEntry(auth, { direction: 'in', category, amount, date, accountId, paymentMode, description, party, reference: reference ?? undefined });
    entries += 1;
  }
  // A small cash expense today-ish so the day book shows money both ways.
  const outDate = workingDay(today, 0);
  if (outDate >= OPENING_DATE) {
    await accounts.createEntry(auth, {
      direction: 'out', category: 'supplies', amount: 64000, date: outDate, accountId: cashId, paymentMode: 'cash',
      description: 'First-aid box refills', party: 'Apollo Pharmacy, Dwarka', reference: undefined,
    });
    entries += 1;
  }

  // Cash -> bank deposits, never more than the cash box holds that day (keep ₹20,000 float).
  let transfers = 0;
  for (const [date, want] of [['2026-04-20', 15000000], ['2026-07-20', 12000000], ['2026-09-21', 5000000]]) {
    if (date > today) continue;
    const available = (await balanceOn(cashId, date)) - 2000000;
    const amount = Math.min(want, Math.floor(available / 100000) * 100000);
    if (amount <= 0) continue;
    await accounts.transfer(auth, { fromAccountId: cashId, toAccountId: bankId, amount, date, reference: `Deposit slip ${4400 + transfers}` });
    transfers += 1;
  }
  return { entries, transfers };
}

// =====================================================================
// Run
// =====================================================================

try {
  const demo = await loadDemo();
  if (!demo) {
    logger.info('Demo finance skipped: no demo school (tenant code "demo")');
  } else {
    const summary = {
      phase1: (await phaseOne(demo)) ?? 'skipped',
      phase2: (await phaseTwo(demo)) ?? 'skipped',
    };
    logger.info('Demo finance ready', summary);
  }
  await pool.end();
} catch (err) {
  logger.error('Demo finance failed', { error: err.message, stack: err.stack });
  await pool.end().catch(() => {});
  process.exit(1);
}
void env; // imported for its validation side effect
