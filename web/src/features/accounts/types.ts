/** Types for the day book (`/accounts`, `/daybook`, `/ledger`) and the shared category lists. */

export type Money = string;

export const INCOME_CATEGORIES = ['fees', 'admission', 'donation', 'transport', 'canteen', 'grant', 'interest', 'other_income'] as const;
/** Income a person may record by hand (fees come only from fee collection). */
export const MANUAL_INCOME_CATEGORIES = INCOME_CATEGORIES.filter((c) => c !== 'fees');
export const EXPENSE_CATEGORIES = [
  'salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'rent', 'printing', 'canteen', 'bank_charges', 'taxes', 'other',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  fees: 'Fees',
  admission: 'Admission & forms',
  donation: 'Donation',
  transport: 'Transport',
  canteen: 'Canteen',
  grant: 'Grant',
  interest: 'Interest',
  other_income: 'Other income',
  salary: 'Salary',
  utilities: 'Utilities',
  maintenance: 'Maintenance',
  supplies: 'Supplies',
  events: 'Events',
  rent: 'Rent',
  printing: 'Printing & stationery',
  bank_charges: 'Bank charges',
  taxes: 'Taxes & fees',
  other: 'Other',
  fee_refund: 'Fee refund',
  transfer: 'Transfer',
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());

/** Bar colours for category breakdowns (expenses page + month summary). */
export const CATEGORY_COLOR: Record<string, string> = {
  fees: 'bg-indigo-500',
  admission: 'bg-sky-500',
  donation: 'bg-emerald-500',
  transport: 'bg-teal-500',
  canteen: 'bg-orange-400',
  grant: 'bg-violet-500',
  interest: 'bg-lime-500',
  other_income: 'bg-slate-400',
  salary: 'bg-indigo-500',
  utilities: 'bg-sky-500',
  maintenance: 'bg-amber-500',
  supplies: 'bg-violet-500',
  events: 'bg-pink-500',
  rent: 'bg-rose-500',
  printing: 'bg-cyan-500',
  bank_charges: 'bg-stone-400',
  taxes: 'bg-red-400',
  other: 'bg-slate-400',
};
export const categoryColor = (c: string) => CATEGORY_COLOR[c] ?? 'bg-slate-400';

export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'demand_draft', 'net_banking'] as const;
export const EXPENSE_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number] | 'wallet' | 'online' | 'other';
const MODE_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', demand_draft: 'Demand draft',
  net_banking: 'Net banking', wallet: 'Wallet', online: 'Online', other: 'Other',
};
export const modeLabel = (m: string) => MODE_LABEL[m] ?? m;

export type AccountType = 'cash' | 'bank' | 'upi';
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  details: string | null;
  isDefault: boolean;
  defaultFor: 'cash' | 'bank' | null;
  isActive: boolean;
  openingBalance: Money;
  openingDate: string;
  balance?: Money;
  entries?: number;
  firstEntryDate?: string | null;
  lastEntryDate?: string | null;
}

export interface BranchInfo {
  id: string;
  name: string;
  schoolName: string;
  address: string | null;
  phone: string | null;
}

export interface AccountsResponse {
  data: Account[];
  meta: { branch: BranchInfo; today: string; totalBalance: Money };
}

export type EntrySource = 'fee_receipt' | 'fee_refund' | 'fee_cancel' | 'expense' | 'manual' | 'transfer';

export interface LedgerEntry {
  id: string;
  date: string;
  postedAt: string;
  voucherNo: string | null;
  direction: 'in' | 'out';
  category: string;
  amount: Money;
  party: string | null;
  description: string;
  paymentMode: string;
  reference: string | null;
  account: { id: string; name: string; type: AccountType };
  source: EntrySource;
  online: boolean;
  links: {
    feeReceiptId: string | null;
    studentId: string | null;
    expenseId: string | null;
    transferId: string | null;
    paymentOrderId: string | null;
    reversesEntryId: string | null;
  };
  canDelete: boolean;
  createdBy: { name: string } | null;
  deleted?: { at: string; by: string | null; reason: string };
  in?: Money;
  out?: Money;
  balance?: Money;
}

export interface AccountMovement {
  account: { id: string; name: string; type: AccountType; isDefault: boolean; isActive: boolean };
  opening: Money;
  in: Money;
  out: Money;
  closing: Money;
}

export interface DayBook {
  date: string;
  today: string;
  branch: BranchInfo;
  accountId: string | null;
  opening: Money;
  totalIn: Money;
  totalOut: Money;
  closing: Money;
  entries: LedgerEntry[];
  byAccount: AccountMovement[];
}

export interface DayBookRange {
  from: string;
  to: string;
  today: string;
  branch: BranchInfo;
  accountId: string | null;
  opening: Money;
  totalIn: Money;
  totalOut: Money;
  closing: Money;
  days: Array<{ date: string; opening: Money; in: Money; out: Money; closing: Money; entries: number }>;
  byAccount: AccountMovement[];
}

export interface MonthSummary {
  month: string | null;
  from: string;
  to: string;
  branch: BranchInfo;
  income: Array<{ category: string; amount: Money }>;
  expense: Array<{ category: string; amount: Money }>;
  feeRefunds: Money;
  transfers: Money;
  totalIncome: Money;
  totalExpense: Money;
  net: Money;
  byAccount: AccountMovement[];
}
