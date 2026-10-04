'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import { Button, Page, PageHeader, Tabs } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { currentUser } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { errorText, todayLocal, useFlash } from '@/features/admin/shared';
import DayView, { PrintDayBook } from './DayView';
import { AccountModal, DeleteEntryModal, EntryModal, TransferModal } from './EntryModals';
import { AccountsView, PrintRange, RangeView, SummaryView } from './OtherViews';
import type { Account, AccountsResponse, DayBook, DayBookRange, LedgerEntry, MonthSummary } from './types';
import { downloadFile, monthStart } from './util';

type Tab = 'day' | 'range' | 'summary' | 'accounts';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'day', label: 'Day book' },
  { value: 'range', label: 'Date range' },
  { value: 'summary', label: 'Month summary' },
  { value: 'accounts', label: 'Accounts' },
];
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default function DayBookPage() {
  const params = useSearchParams();
  const flash = useFlash();
  const initialTab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'day') as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [date, setDate] = useState(isDate(params.get('date')) ? params.get('date')! : todayLocal());
  const [accountId, setAccountId] = useState(params.get('account') ?? '');
  const [from, setFrom] = useState(monthStart(todayLocal()));
  const [to, setTo] = useState(todayLocal());
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [entryModal, setEntryModal] = useState<'in' | 'out' | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null);
  const [accountModal, setAccountModal] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null });
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState<'day' | 'range' | null>(null);

  const accountsRes = useApi<AccountsResponse>('/accounts');
  const accounts = accountsRes.data?.data ?? [];
  const today = accountsRes.data?.meta.today ?? todayLocal();
  // The school's "today" can differ from this browser's (time zones): never ask for a future day.
  useEffect(() => {
    if (accountsRes.data && date > accountsRes.data.meta.today) setDate(accountsRes.data.meta.today);
    if (accountsRes.data && to > accountsRes.data.meta.today) setTo(accountsRes.data.meta.today);
  }, [accountsRes.data, date, to]);

  const day = useApi<{ data: DayBook }>(tab === 'day' ? `/daybook${qs({ date, accountId })}` : null);
  const range = useApi<{ data: DayBookRange }>(tab === 'range' && from <= to ? `/daybook/range${qs({ from, to, accountId })}` : null);
  const summary = useApi<{ data: MonthSummary }>(tab === 'summary' ? `/accounts/summary${qs({ month })}` : null);

  // Print only after the print layout for the current data is on the page.
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  const refreshAll = () => {
    accountsRes.reload();
    if (tab === 'day') day.reload();
    if (tab === 'range') range.reload();
    if (tab === 'summary') summary.reload();
  };

  async function exportCsv(f: string, t: string) {
    setExporting(true);
    try {
      await downloadFile(`/ledger/export.csv${qs({ from: f, to: t, accountId })}`, `daybook-${f}-to-${t}.csv`);
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setExporting(false);
    }
  }

  const accountName = accountId ? (accounts.find((a) => a.id === accountId)?.name ?? 'Account') : 'All accounts';
  const user = currentUser();
  const printedBy = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : 'School office';
  const openDay = (d: string) => {
    setDate(d);
    setTab('day');
  };
  const afterSave = (entryDate: string, text: string) => {
    flash.show('success', text);
    if (tab === 'day' && entryDate !== date) setDate(entryDate);
    refreshAll();
  };

  return (
    <>
      <div className="print:hidden">
        <Page wide>
          <PageHeader
            title="Day book"
            description="Every rupee in and out of the school's cash and bank accounts, with a running balance."
            actions={
              <>
                <Button icon={<Plus aria-hidden />} onClick={() => setEntryModal('in')}>
                  Add income
                </Button>
                <Button variant="secondary" icon={<Minus aria-hidden />} onClick={() => setEntryModal('out')}>
                  Add expense
                </Button>
                <Button variant="secondary" icon={<ArrowLeftRight aria-hidden />} onClick={() => setTransferOpen(true)}>
                  Transfer
                </Button>
              </>
            }
          />
          {flash.node}
          <Tabs value={tab} onChange={setTab} items={TABS} />

          {tab === 'day' && (
            <DayView
              date={date}
              onDate={setDate}
              accountId={accountId}
              onAccount={setAccountId}
              accounts={accounts}
              book={day.data?.data ?? null}
              loading={day.loading}
              error={day.error}
              reload={day.reload}
              onDelete={setDeleting}
              onPrint={() => setPrinting('day')}
              onExport={() => exportCsv(date, date)}
              exporting={exporting}
            />
          )}
          {tab === 'range' && (
            <RangeView
              from={from}
              to={to}
              onRange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
              accountId={accountId}
              onAccount={setAccountId}
              accounts={accounts}
              data={range.data?.data ?? null}
              loading={range.loading}
              error={range.error}
              reload={range.reload}
              today={today}
              onOpenDay={openDay}
              onPrint={() => setPrinting('range')}
              onExport={() => exportCsv(from, to)}
              exporting={exporting}
            />
          )}
          {tab === 'summary' && <SummaryView month={month} onMonth={setMonth} today={today} data={summary.data?.data ?? null} loading={summary.loading} error={summary.error} reload={summary.reload} />}
          {tab === 'accounts' && (
            <AccountsView
              accounts={accounts}
              totalBalance={accountsRes.data?.meta.totalBalance ?? null}
              loading={accountsRes.loading}
              error={accountsRes.error}
              reload={accountsRes.reload}
              onAdd={() => setAccountModal({ open: true, account: null })}
              onEdit={(a) => setAccountModal({ open: true, account: a })}
              onOpen={(a) => {
                setAccountId(a.id);
                setTab('day');
              }}
            />
          )}
        </Page>

        <EntryModal
          direction={entryModal ?? 'in'}
          open={entryModal !== null}
          accounts={accounts}
          today={today}
          defaultDate={tab === 'day' ? date : today}
          onClose={() => setEntryModal(null)}
          onSaved={(e) => {
            setEntryModal(null);
            afterSave(e.date, `${e.direction === 'in' ? 'Income' : 'Expense'} ${formatInr(e.amount)} recorded as voucher ${e.voucherNo} (${e.account.name}, ${formatDate(e.date)}).`);
          }}
        />
        <TransferModal
          open={transferOpen}
          accounts={accounts}
          today={today}
          defaultDate={tab === 'day' ? date : today}
          onClose={() => setTransferOpen(false)}
          onSaved={(r) => {
            setTransferOpen(false);
            afterSave(r.out.date, `${formatInr(r.amount)} moved from ${r.out.account.name} to ${r.in.account.name} (voucher ${r.voucherNo}).`);
          }}
        />
        <DeleteEntryModal
          entry={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(e) => {
            setDeleting(null);
            flash.show('success', `Deleted voucher ${e.voucherNo} (${formatInr(e.amount)}). It stays in the audit trail with your reason.`);
            refreshAll();
          }}
        />
        <AccountModal
          open={accountModal.open}
          account={accountModal.account}
          today={today}
          onClose={() => setAccountModal({ open: false, account: null })}
          onSaved={(a) => {
            setAccountModal({ open: false, account: null });
            flash.show('success', `Saved ${a.name}.`);
            refreshAll();
          }}
        />
      </div>

      {tab === 'day' && day.data && <PrintDayBook book={day.data.data} accountName={accountName} printedBy={printedBy} />}
      {tab === 'range' && range.data && <PrintRange data={range.data.data} accountName={accountName} printedBy={printedBy} />}
    </>
  );
}
