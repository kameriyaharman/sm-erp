'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FilePlus2, Layers, PlusCircle } from 'lucide-react';
import FeeCollectionTable from '@/features/fees/FeeCollectionTable';
import FeesNav from '@/features/fees/FeesNav';
import AddChargeModal from '@/features/fees/AddChargeModal';
import BulkBillModal from '@/features/fees/BulkBillModal';
import { createFeesApi } from '@/features/fees/api';
import RequireAuth from '@/components/RequireAuth';
import { Button, Page, PageHeader, Spinner, buttonClass } from '@/components/ui';
import { formatDate, formatInr } from '@/lib/format';
import { API_BASE, getAccessToken } from '@/lib/session';
import { useFlash } from '@/features/admin/shared';

function Fees() {
  const api = useMemo(
    () => createFeesApi({ baseUrl: API_BASE, getAccessToken, onUnauthorized: () => window.location.assign('/login?next=/fees') }),
    [],
  );
  const params = useSearchParams();
  const flash = useFlash(9000);
  const [charging, setCharging] = useState(false);
  const [billing, setBilling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Filters live in the URL, so other screens link straight to a view:
  // /fees?search=DPS-1015, /fees?status=overdue, /fees?classId=…&sectionId=…
  return (
    <Page wide>
      <FeesNav />
      <PageHeader
        title="Fee collection"
        description="Collect fees at the counter, print receipts and see what is still pending."
        actions={
          <>
            <Link href="/fees/setup" className={buttonClass({ variant: 'secondary' })}>
              <Layers className="h-4 w-4" aria-hidden />
              Set class fees
            </Link>
            <Button variant="secondary" icon={<FilePlus2 aria-hidden />} onClick={() => setBilling(true)} data-bulk-open>
              Generate bills
            </Button>
            <Button icon={<PlusCircle aria-hidden />} onClick={() => setCharging(true)}>
              Add charge
            </Button>
          </>
        }
      />
      {flash.node}
      <FeeCollectionTable api={api} refreshKey={refreshKey} />
      <BulkBillModal
        open={billing}
        defaultClassId={params.get('classId') ?? ''}
        defaultSectionId={params.get('sectionId') ?? ''}
        onClose={() => setBilling(false)}
        onDone={(r) => {
          setBilling(false);
          setRefreshKey((k) => k + 1);
          flash.show(
            (r.invoicesCreated ?? 0) > 0 ? 'success' : 'info',
            (r.invoicesCreated ?? 0) > 0
              ? `Generated ${r.invoicesCreated} ${r.invoicesCreated === 1 ? 'bill' : 'bills'} for ${r.target.label} (instalments due up to ${formatDate(r.billUpTo)}): ${formatInr(r.total)} in all. Parents can pay them online now.`
              : `Nothing new to bill for ${r.target.label}: every instalment due by ${formatDate(r.billUpTo)} is already billed.`,
          );
        }}
      />
      <AddChargeModal
        open={charging}
        defaultClassId={params.get('classId') ?? ''}
        defaultSectionId={params.get('sectionId') ?? ''}
        onClose={() => setCharging(false)}
        onDone={(r) => {
          setCharging(false);
          setRefreshKey((k) => k + 1);
          flash.show(
            'success',
            r.invoicesCreated > 0
              ? `Charged ${formatInr(r.amount)} “${r.description}” to ${r.invoicesCreated === 1 && r.target.studentId ? r.target.label : `${r.invoicesCreated} student${r.invoicesCreated === 1 ? '' : 's'} of ${r.target.label}`}: ${formatInr(r.total)} in all.${r.alreadyCharged ? ` ${r.alreadyCharged} already had it.` : ''}`
              : 'Everyone selected already had this charge. Nothing new was billed.',
          );
        }}
      />
    </Page>
  );
}

export default function FeesPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <Fees />
      </Suspense>
    </RequireAuth>
  );
}
