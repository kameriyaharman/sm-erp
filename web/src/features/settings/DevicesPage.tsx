'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CirclePause, CirclePlay, Fingerprint, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, Pagination, SearchInput, Select, Spinner, Table, Tabs, Td, Textarea, Th, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { ConfirmModal, errorText, fieldErrors, useDebounced, useFlash } from '@/features/admin/shared';
import { CopyField } from '@/features/payments/bits';
import { SettingsHeader, timeAgo } from './bits';
import type { Branch, Device, DeviceKind, Identifier, Punch } from './types';

/**
 * Settings -> Attendance devices: gate devices, the card / device-user numbers of students and
 * staff, and every punch received with what was done with it.
 */

type Tab = 'devices' | 'numbers' | 'punches';

export default function DevicesPage() {
  const [tab, setTab] = useState<Tab>('devices');
  const flash = useFlash(12000);
  const list = useApi<{ data: { branches: Branch[]; devices: Device[] } }>('/settings/devices');
  const branches = list.data?.data.branches ?? [];
  return (
    <Page>
      <SettingsHeader
        title="Attendance devices"
        description="RFID card readers, fingerprint and face terminals, QR scanners and gate apps. Students are marked present (or late) when they punch in; parents can get a “reached school” message."
      />
      {flash.node}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'devices', label: 'Devices' },
          { value: 'numbers', label: 'Card & device numbers' },
          { value: 'punches', label: 'Punch log' },
        ]}
      />
      {list.error ? (
        <Card>
          <ErrorState message={list.error} onRetry={list.reload} />
        </Card>
      ) : tab === 'devices' ? (
        <DevicesTab devices={list.data?.data.devices ?? null} branches={branches} reload={list.reload} onFlash={flash.show} />
      ) : tab === 'numbers' ? (
        <NumbersTab branches={branches} onFlash={flash.show} />
      ) : (
        <PunchesTab devices={list.data?.data.devices ?? []} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ devices

const KIND_OPTIONS: Array<{ value: DeviceKind; label: string }> = [
  { value: 'biometric', label: 'Biometric (fingerprint)' },
  { value: 'face', label: 'Face recognition' },
  { value: 'rfid', label: 'RFID card reader' },
  { value: 'qr', label: 'QR code scanner' },
  { value: 'gate_app', label: 'Gate app / tablet' },
];

function DevicesTab({ devices, branches, reload, onFlash }: { devices: Device[] | null; branches: Branch[]; reload: () => void; onFlash: (t: 'success' | 'error' | 'info' | 'warn', m: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ device: Device; apiKey: string | null } | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(d: Device) {
    try {
      await apiSend('PATCH', `/settings/devices/${d.id}`, { status: d.status === 'active' ? 'inactive' : 'active' });
      reload();
    } catch (err) {
      onFlash('error', errorText(err));
    }
  }
  async function rotate(d: Device) {
    try {
      const r = await apiSend<{ data: { apiKey: string } }>('POST', `/settings/devices/${d.id}/rotate-key`, {});
      setShown({ device: d, apiKey: r.data.apiKey });
      reload();
    } catch (err) {
      onFlash('error', errorText(err));
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await apiSend('DELETE', `/settings/devices/${removing.id}`);
      setRemoving(null);
      reload();
      onFlash('success', `${removing.name} removed. Its punches stay in the log.`);
    } catch (err) {
      onFlash('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!devices) return <Spinner label="Loading devices" />;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
          Add device
        </Button>
      </div>
      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Fingerprint aria-hidden />}
            title="No devices yet"
            description="Add your biometric or face terminal (eSSL / ZKTeco push), an RFID reader, or a phone / tablet at the gate."
            action={<Button onClick={() => setAdding(true)}>Add device</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((d) => {
            const online = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 15 * 60_000;
            return (
              <Card
                key={d.id}
                title={d.name}
                description={[d.kindLabel, d.location, branches.length > 1 ? d.branchName : null].filter(Boolean).join(' · ')}
                actions={d.status !== 'active' ? <Badge>Paused</Badge> : online ? <Badge tone="green" dot>Online</Badge> : <Badge tone="amber" dot>{d.lastSeenAt ? `Seen ${timeAgo(d.lastSeenAt)}` : 'Never connected'}</Badge>}
              >
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-13 text-slate-500">Connects with</dt>
                    <dd>{d.protocol === 'adms' ? 'eSSL / ZKTeco push' : 'Device key'}</dd>
                  </div>
                  <div>
                    <dt className="text-13 text-slate-500">{d.protocol === 'adms' ? 'Serial number' : 'Key'}</dt>
                    <dd className="font-mono text-13">{d.protocol === 'adms' ? d.serialNumber : `${d.keyPrefix}••••`}</dd>
                  </div>
                  <div>
                    <dt className="text-13 text-slate-500">Records</dt>
                    <dd>{d.appliesTo === 'both' ? 'Students and staff' : d.appliesTo === 'students' ? 'Students' : 'Staff'}</dd>
                  </div>
                  <div>
                    <dt className="text-13 text-slate-500">Punches today</dt>
                    <dd className="tabular-nums">{d.punchesToday}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="secondary" onClick={() => setShown({ device: d, apiKey: null })}>
                    Setup steps
                  </Button>
                  {d.protocol === 'http' && (
                    <Button size="sm" variant="secondary" icon={<KeyRound aria-hidden />} onClick={() => rotate(d)}>
                      New key
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" icon={d.status === 'active' ? <CirclePause aria-hidden /> : <CirclePlay aria-hidden />} onClick={() => toggle(d)}>
                    {d.status === 'active' ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 dark:text-red-300" icon={<Trash2 aria-hidden />} onClick={() => setRemoving(d)}>
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AddDeviceModal
        open={adding}
        branches={branches}
        onClose={() => setAdding(false)}
        onCreated={(device, apiKey) => {
          setAdding(false);
          setShown({ device, apiKey });
          reload();
        }}
      />
      <SetupModal shown={shown} onClose={() => setShown(null)} />
      <ConfirmModal open={Boolean(removing)} title={`Remove ${removing?.name ?? 'device'}?`} confirmLabel="Remove" busy={busy} onConfirm={remove} onClose={() => setRemoving(null)}>
        <p>The device can no longer send punches. Attendance it already recorded is kept.</p>
      </ConfirmModal>
    </>
  );
}

function AddDeviceModal({ open, branches, onClose, onCreated }: { open: boolean; branches: Branch[]; onClose: () => void; onCreated: (d: Device, key: string | null) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('biometric');
  const [protocol, setProtocol] = useState<'http' | 'adms'>('adms');
  const [serial, setSerial] = useState('');
  const [location, setLocation] = useState('');
  const [appliesTo, setAppliesTo] = useState<'both' | 'students' | 'staff'>('both');
  const [branchId, setBranchId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSerial('');
    setLocation('');
    setErrors({});
    setFormError(null);
    setBranchId(branches[0]?.id ?? '');
  }, [open, branches]);
  useEffect(() => setProtocol(kind === 'biometric' || kind === 'face' ? 'adms' : 'http'), [kind]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const r = await apiSend<{ data: { device: Device; apiKey: string | null } }>('POST', '/settings/devices', {
        name: name.trim(),
        kind,
        protocol,
        ...(protocol === 'adms' && { serialNumber: serial.trim() }),
        location: location.trim() || null,
        appliesTo,
        ...(branchId && { branchId }),
      });
      onCreated(r.data.device, r.data.apiKey);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an attendance device"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-device" loading={busy}>
            Add device
          </Button>
        </>
      }
    >
      <form id="add-device" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main gate biometric" error={errors.name} className="sm:col-span-2" />
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Select label="Connects with" value={protocol} onChange={(e) => setProtocol(e.target.value as 'http' | 'adms')} hint={protocol === 'adms' ? 'Most eSSL, ZKTeco, Realtime and Identix terminals: "Cloud server / ADMS" setting.' : 'A key for a gate app, RFID middleware or your vendor’s software.'}>
          <option value="adms">eSSL / ZKTeco push (ADMS)</option>
          <option value="http">Device key (API)</option>
        </Select>
        {protocol === 'adms' && (
          <Input label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="CQZ7231260021" hint="Menu -> System info -> Device info on the terminal." error={errors.serialNumber} className="sm:col-span-2 [&_input]:font-mono" />
        )}
        <Input label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main gate" />
        <Select label="Records" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as typeof appliesTo)}>
          <option value="both">Students and staff</option>
          <option value="students">Students only</option>
          <option value="staff">Staff only</option>
        </Select>
        {branches.length > 1 && (
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:col-span-2">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {formError && (
          <div className="sm:col-span-2">
            <Notice tone="error">{formError}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}

function SetupModal({ shown, onClose }: { shown: { device: Device; apiKey: string | null } | null; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-sm-erp-address';
  const host = typeof window !== 'undefined' ? window.location.host : 'your-sm-erp-address';
  const d = shown?.device;
  return (
    <Modal open={Boolean(shown)} onClose={onClose} title={d ? `Set up ${d.name}` : 'Set up'} size="lg" footer={<Button onClick={onClose}>Done</Button>}>
      {d?.protocol === 'adms' ? (
        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          <p>On the terminal: <b>Menu → Comm. → Cloud Server Setting</b> (or ADMS):</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Server address: <CopyField value={host} label="Server address" />
            </li>
            <li>Server port: <b>443</b>, HTTPS on (or “Enable domain name”: on).</li>
            <li>Proxy: off. Save and restart the terminal.</li>
            <li>
              Enrol each person on the terminal with their <b>admission number</b> (students) or <b>employee code</b> (staff) as the user ID, or list the
              terminal’s user IDs under “Card &amp; device numbers”.
            </li>
          </ol>
          <Notice>Within a minute the device shows as Online here. Test with a punch and check the Punch log.</Notice>
        </div>
      ) : d ? (
        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          {shown?.apiKey ? (
            <>
              <Notice tone="warn">Copy the key now: it is shown only once. Lost it? Use “New key”.</Notice>
              <CopyField value={shown.apiKey} label="Device key" large />
            </>
          ) : (
            <p>The key was shown when it was created. Use “New key” to get another (the old one stops working).</p>
          )}
          <p>Send each punch to:</p>
          <CopyField value={`${origin}/api/v1/devices/punch`} label="Punch URL" />
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100">{`POST ${origin}/api/v1/devices/punch
X-Device-Key: ${shown?.apiKey ?? 'smd_…'}
Content-Type: application/json

{ "identifier": "DPS-1001", "at": "2026-10-09 07:55:12" }
// or a batch: { "punches": [ { "identifier": "...", "at": "..." }, ... ] }`}</pre>
          <p>
            <b>identifier</b>: the card number, QR value or device user ID; admission numbers and employee codes work without any mapping. <b>at</b>: school time or ISO 8601;
            leave it out for “now”.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ card numbers

function NumbersTab({ branches, onFlash }: { branches: Branch[]; onFlash: (t: 'success' | 'error' | 'info' | 'warn', m: string) => void }) {
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const branch = branchId || branches[0]?.id || '';
  const list = useApi<{ data: Identifier[]; meta: { totalPages: number; total: number } }>(branch ? `/settings/devices/identifiers${qs({ branchId: branch, search: debounced, page, limit: 50 })}` : null);
  const [kind, setKind] = useState<'rfid' | 'biometric' | 'face' | 'qr'>('rfid');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved: number; replaced: number; errors: Array<{ line: number; number: string; message: string }> } | null>(null);

  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split(/[,\t;]/).map((x) => x.trim()))
    .filter((c) => c.length >= 2 && c[0] && c[1]);

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const r = await apiSend<{ data: typeof result }>('PUT', '/settings/devices/identifiers', { branchId: branch, kind, rows: rows.map(([number, value]) => ({ number, value })) });
      setResult(r.data);
      if (r.data && r.data.errors.length === 0) setText('');
      list.reload();
    } catch (err) {
      onFlash('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiSend('DELETE', `/settings/devices/identifiers/${id}`);
      list.reload();
    } catch (err) {
      onFlash('error', errorText(err));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
      <Card title="Add numbers" description="One per line: admission number (or employee code), then the card / device number.">
        <div className="flex flex-col gap-3">
          {branches.length > 1 && (
            <Select label="Branch" value={branch} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          <Select label="Number type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="rfid">RFID card number</option>
            <option value="biometric">Biometric device user ID</option>
            <option value="face">Face device user ID</option>
            <option value="qr">QR code value</option>
          </Select>
          <Textarea label="Numbers" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'DPS-1001, 0004521873\nDPS-1002, 0004521874\nEMP-101, 0004529001'} className="font-mono text-13" hint="Paste two columns from Excel. A new card replaces the person’s old one." />
          <Button onClick={save} loading={busy} disabled={rows.length === 0}>
            Save {rows.length || ''} number{rows.length === 1 ? '' : 's'}
          </Button>
          {result && (
            <Notice tone={result.errors.length ? 'warn' : 'success'}>
              {result.saved} saved{result.replaced ? ` (${result.replaced} replaced an old card)` : ''}.
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={e.line}>
                      Line {e.line} ({e.number}): {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      </Card>

      <Card title="Saved numbers" description={list.data ? `${list.data.meta.total} saved` : undefined} padded={false}>
        <div className="border-b border-line p-3">
          <SearchInput label="Search" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Name, admission no. or card number" />
        </div>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Spinner skeleton />
        ) : list.data.data.length === 0 ? (
          <EmptyState title="No numbers saved" description="Admission numbers and employee codes work on devices without saving anything here." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Type</Th>
                  <Th>Number</Th>
                  <Th align="right">
                    <span className="sr-only">Remove</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {r.person.name}
                      <span className="block text-xs text-slate-500">
                        {r.person.type === 'staff' ? 'Staff' : 'Student'} · {r.person.number}
                      </span>
                    </Td>
                    <Td className="text-13">{r.kind.toUpperCase()}</Td>
                    <Td className="font-mono text-13">{r.value}</Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 aria-hidden />} onClick={() => remove(r.id)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ punch log

const RESULT: Record<string, { tone: BadgeTone; label: string }> = {
  present: { tone: 'green', label: 'Present' },
  late: { tone: 'amber', label: 'Late' },
  staff_in: { tone: 'green', label: 'Staff in' },
  staff_out: { tone: 'indigo', label: 'Staff out' },
  already_marked: { tone: 'gray', label: 'Already marked' },
  duplicate: { tone: 'gray', label: 'Repeat punch' },
  unknown_identifier: { tone: 'red', label: 'Unknown number' },
  holiday: { tone: 'gray', label: 'Holiday' },
  outside_window: { tone: 'gray', label: 'Outside hours' },
  not_enrolled: { tone: 'red', label: 'Not enrolled' },
  ignored: { tone: 'gray', label: 'Ignored' },
};

function PunchesTab({ devices }: { devices: Device[] }) {
  const [deviceId, setDeviceId] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<{ data: Punch[]; meta: { totalPages: number; total: number } }>(`/settings/devices/punches${qs({ deviceId, result, page, limit: 50 })}`);
  return (
    <Card padded={false}>
      <div className="flex flex-wrap gap-3 border-b border-line p-3">
        <div className="w-56"><Select value={deviceId} onChange={(e) => (setDeviceId(e.target.value), setPage(1))} aria-label="Device">
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select></div>
        <div className="w-48"><Select value={result} onChange={(e) => (setResult(e.target.value), setPage(1))} aria-label="Result">
          <option value="">All results</option>
          {Object.entries(RESULT).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select></div>
        <Button variant="secondary" onClick={reload}>
          Refresh
        </Button>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Spinner skeleton />
      ) : data.data.length === 0 ? (
        <EmptyState title="No punches" description="Punches appear here as soon as a device sends them." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Person</Th>
                <Th>Number</Th>
                <Th>Result</Th>
                <Th>Device</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((p) => {
                const r = RESULT[p.result] ?? { tone: 'gray' as BadgeTone, label: p.result };
                return (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap tabular-nums">{formatDateTime(p.punchedAt)}</Td>
                    <Td>{p.person ? <>{p.person.name ?? '-'}<span className="block text-xs text-slate-500">{p.person.type === 'staff' ? 'Staff' : 'Student'}</span></> : <span className="text-slate-400">-</span>}</Td>
                    <Td className="font-mono text-13">{p.identifier}</Td>
                    <Td>
                      <Badge tone={r.tone}>{r.label}</Badge>
                      {p.detail && <span className="mt-0.5 block text-xs text-slate-500">{p.detail}</span>}
                    </Td>
                    <Td className="text-13">{p.device}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
