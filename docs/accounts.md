# Accounts, day book and fee setup: design

Client asks: "class wise admin fee define kar sake ki kis class ke student ki kitni fee hai" and "expense wale section
me in out wala pura module day book jaisa hona chahiye". Migration `api/db/migrations/012_fee_setup_daybook.sql`,
API `api/src/modules/accounts/` and `api/src/modules/fee-setup/`, screens `/accounts` (Day book) and `/fees/setup`.
Endpoints: `docs/api-v2-contract.md` section 14. Roles: `docs/rbac.md` (admins only).

## 1. One materialised ledger

Every rupee that enters or leaves a school account is exactly one row of `ledger_entries` (`direction` in|out,
`account_id`, `category`, `amount`, `entry_date`, voucher, source link). The day book, range view, month summary,
account balances and the CSV export are all plain queries over this one table, so they always agree.

Rows are written **by the database**, so no code path (counter collection, online payments, seeds, a future module)
can forget to post or post twice:

| Source | Trigger | Entry |
|---|---|---|
| `fee_receipts` INSERT (counter and online) | `trg_fee_receipts_ledger` | `in`, category `fees`, voucher = receipt number, account = default **Cash** account for `cash`, default **Bank** account for every other mode (UPI, card, cheque, DD, transfer, gateway) |
| `fee_receipts` UPDATE of date / amount / mode | same | the receipt's entry follows (re-dated receipts, mode corrections) |
| receipt cancelled (`status = 'cancelled'` or `cancelled_at` set, whichever columns the receipts table has) | same | `out`, source `fee_cancel`, category `fee_refund`, for whatever of the receipt is not reversed yet |
| `fee_transactions` refund reaching `success` | `trg_fee_transactions_ledger` | `out`, source `fee_refund`, same account as the receipt, **capped** at what is left of the receipt |
| `expenses` INSERT | `trg_expenses_ledger` | `out`, expense category, voucher `VCH`, account = `expenses.account_id` or the default by mode |
| `expenses` soft delete / correction | same | entry soft-deleted with the same reason / kept in step |
| manual income (`POST /ledger`, direction in) | API | `in`, source `manual`, voucher `VCH` |
| manual expense (`POST /ledger`, direction out) | API writes an **expenses** row | the expenses trigger posts it (so it also shows on the Expenses page and the dashboard) |
| transfer / contra (`POST /accounts/transfer`) | API | two rows (`out` of A, `in` to B), one voucher, shared `transfer_id`, category `transfer` |

**Never double counted.** Partial unique indexes: one `fee_receipt` entry per receipt, one `fee_cancel` per receipt,
one `fee_refund` per refund transaction, one `expense` entry per expense, one leg per direction per transfer. Every
posting function first checks for its row. Refunds + cancellation of a receipt never exceed the receipt
(`ledger_receipt_unreversed`).

**Existing data** (live DB): the migration back-posts every receipt, successful refund and live expense in date
order, so vouchers run in date order and the day book is complete from day one. Default accounts are created on
first use ("Cash in hand", "Bank account", opening ₹0 at the start of that financial year).

**The `/expenses` endpoints stay** (Expenses page, dashboard `/expenses/monthly`). They now take an optional
`accountId`, return `voucherNo` and `account`, and their delete soft-deletes the day-book entry too.

## 2. Vouchers

`BRANCHCODE/VCH/2026-27/00007`: gap-free per branch per **Indian financial year** (April–March), from the same
row-locked `document_sequences` counter as invoices and receipts (`doc_type = 'voucher'`; the type check was widened
to any lower-case identifier). Numbers roll back with their transaction; deleted entries keep their number (soft
delete with reason, `deleted_by`, `deleted_at`). Fee entries use the receipt number as their voucher.

## 3. Balances

- An account's book starts on its `opening_date` with `opening_balance` (balance at the start of that day).
- `opening(D)` of a set of accounts = opening balances of accounts opened on or before D + net of live entries dated
  before D. `closing(D) = opening(D) + in(D) − out(D)`, and `opening(D+1) = closing(D)` (plus any account whose book
  starts on D+1). Pure helpers in `api/src/modules/accounts/daybook.helpers.js`, unit-tested in `api/test/accounts.test.js`.
- Entries are never dated before their account's opening date: manual entries/transfers are rejected
  (422 `BEFORE_OPENING_DATE`); an automatic posting dated earlier (a back-dated receipt) moves the opening date back;
  `PATCH /accounts` cannot move the opening date past the first entry.
- Mode and account must agree: cash only in cash accounts, everything else in bank / UPI accounts.
- Money in the ledger is immutable: a manual or transfer entry is deleted (with reason) and re-entered, never edited
  (`trg_ledger_entries_guard`); rows are never hard-deleted except by a tenant/branch cascade.

## 4. Income vs expense

Month summary: income by category (`fees` net of fee refunds/cancellations), expense by category (expense
categories), transfers excluded from both. Income categories: `fees` (only via fee collection), `admission`,
`donation`, `transport`, `canteen`, `grant`, `interest`, `other_income`. Expense categories: the expenses table's
`salary, utilities, maintenance, transport, supplies, events, rent, printing, canteen, bank_charges, taxes, other`.

## 5. Fee setup

Reuses `fee_heads`, `fee_structures` (class × year × head × instalment) and `student_fee_allocations` (the student's
dues). New: `student_fee_concessions` (rules: student × year × head-or-all, percentage | flat ₹ per instalment |
full waiver, reason, approver).

- **Saving a structure** matches rows by (head, instalment no.). Changed amounts/due dates flow to the students'
  allocations **that are not on an invoice yet** (their own concession re-computed); removed rows switch off
  un-invoiced allocations (or are deleted if nobody ever had them). An allocation on an invoice is never touched:
  the invoice is the bill. `dryRun` returns the impact for the confirmation prompt.
- **Apply to students** creates missing allocations for enrolled students of the class (idempotent, unique per
  student × structure row), stamping each student's concession rule (head rule beats an all-heads rule).
- **Concession** `PUT` replaces the rules and re-applies them to un-invoiced allocations only.
- Concession maths (integer paise): percentage rounded half up to the paisa; flat capped at the instalment; waiver =
  whole instalment (`schedule.helpers.js`, `api/test/fee-setup.test.js`). The SQL used when a structure amount changes
  (`round(amount * pct / 100, 2)`) rounds the same way for positive amounts.
- Instalment helper: quarterly from the year start on day N = N Apr / Jul / Oct / Jan; a yearly total is split exactly
  (whole rupees stay whole, remainder on the first instalments).
- Late-fee rules are not part of this module (the `late_fee_*` columns of `fee_structures` are left as they were).

## 6. Demo data

`api/scripts/seed-demo-finance.js` (run by `seed-demo-modules.js` in `npm run release`, `SEED_DEMO=true`, tenant
`demo`): fee heads Admission fee / Annual charges / Examination fee / Caution deposit, the Grade 7 structure (applied to
any enrolled Grade 7 students), concession rules for concessions already on allocations; Cash in hand ₹45,000 and SBI
Current A/c ₹32,00,000 as of 1 Apr 2026, an HDFC savings account, manual incomes and cash → bank deposits. Each phase
is skipped once done.

## 7. Cancelling a receipt, billing early (migration `016_receipt_cancellation.sql`)

`POST /fees/receipts/:id/cancel` (ADMINS; contract section 17). `fee_receipts` gets `status` (active | cancelled),
`cancelled_at`, `cancelled_by`, `cancel_reason` (checked together), and a guard trigger: a cancelled receipt can't be
restored, re-dated or re-valued. In ONE transaction, after locking student → receipt → its invoices:

1. the receipt is marked cancelled → `trg_fee_receipts_ledger` (section 1) posts the `fee_cancel` "out" entry for
   whatever of the receipt is not reversed yet, dated the day of cancellation, same account as the receipt's "in";
2. one `refund` transaction per payment line (`refund_of_id` = the payment, `status = success`, remarks "Receipt … cancelled: …").
   This is what `trg_fee_transactions_lock_success` asks for ("record a refund instead"): successful payments are never
   edited or deleted, and the trigger stays. The 002 rollup recomputes `paid_amount`; the invoice status is derived again
   (paid → partially_paid / unpaid). The refund posting trigger is capped at what is left of the receipt — 0 after step 1 —
   so the day book gets exactly **one** reversal per cancelled receipt, never two.

Net effect for the receipt: `in` on its date, `out` on the cancellation date (the day book is cash-basis). Analytics treat
the cancelled receipt as void (neither its payment nor its reversal in "collected by month / by mode").

Online (Razorpay) receipts: cancelling is only a record change; SM ERP never calls the refund API. The API refuses
without `acknowledgeOnlineRefund: true`, answers with the payment id + amount to refund in the Razorpay Dashboard, and the
online-payments console keeps showing "refund at Razorpay" on that order. The order stays `paid`, so a re-delivered
webhook for the same payment is `already_paid` and cannot post the money again.

Billing early: upcoming instalments (un-invoiced allocations) can be billed for one student (`POST /fees/invoices` with
`allocationIds`), for a class / section (`POST /fees/invoices/bulk`, dry run first), or by the family itself
("Pay in advance", only with online payment on). All three copy the allocations unchanged; the unique allocation per
invoice line makes every path idempotent.

