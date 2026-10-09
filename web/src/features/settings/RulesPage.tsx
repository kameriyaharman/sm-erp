'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, RotateCcw, X } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Notice, Page, Select, Spinner, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorText, useFlash } from '@/features/admin/shared';
import { CHANNEL_LABEL, ChannelChip, SettingsHeader, Switch, to12h } from './bits';
import type { Channel, Rule, RuleRow, RulesData, Timing } from './types';

/**
 * Settings -> Notification rules. One card per message: on/off, channels in fallback order
 * (WhatsApp first; if the parent isn't on WhatsApp, SMS; ...), who receives it, and when.
 */
export default function RulesPage() {
  const { data, error, loading, reload, setData } = useApi<{ data: RulesData }>('/settings/notification-rules');
  const flash = useFlash();
  const d = data?.data;
  const groups = useMemo(() => {
    const out = new Map<string, RuleRow[]>();
    for (const r of d?.rules ?? []) out.set(r.group, [...(out.get(r.group) ?? []), r]);
    return [...out];
  }, [d]);

  const replace = (row: RuleRow) => d && setData({ data: { ...d, rules: d.rules.map((r) => (r.key === row.key ? row : r)) } });

  return (
    <Page>
      <SettingsHeader
        title="Notification rules"
        description={
          <>
            Which messages go to parents automatically, over which channels and when. The text of each message is under{' '}
            <Link href="/settings/templates" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
              Message templates
            </Link>
            ; the accounts they go out from under{' '}
            <Link href="/settings/communication" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
              WhatsApp, SMS & email
            </Link>
            .
          </>
        }
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !d ? (
        <Spinner label="Loading rules" />
      ) : d ? (
        <div className="space-y-8">
          {!d.canEdit && <Notice>Only the school owner can change notification rules.</Notice>}
          {groups.map(([group, rows]) => (
            <section key={group}>
              <h2 className="mb-3 text-[15px] font-semibold text-slate-900 dark:text-white">{group}</h2>
              <div className="flex flex-col gap-3">
                {rows.map((row) => (
                  <RuleCard
                    key={`${row.key}-${row.updatedAt ?? 'default'}`}
                    row={row}
                    available={d.channels}
                    canEdit={d.canEdit}
                    onSaved={(next, msg) => {
                      replace(next);
                      flash.show('success', msg);
                    }}
                    onError={(msg) => flash.show('error', msg)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

function describeTiming(t: Timing): string {
  switch (t.mode) {
    case 'immediate':
      return 'Right away';
    case 'delay':
      return `${t.minutes} minutes later`;
    case 'at_time':
      return `At ${to12h(t.time)} (or right away if later)`;
    case 'scheduled':
      return t.autoRun ? `Automatically at ${to12h(t.time)}` : 'When you send them';
    default:
      return '';
  }
}

function RuleCard({
  row,
  available,
  canEdit,
  onSaved,
  onError,
}: {
  row: RuleRow;
  available: RulesData['channels'];
  canEdit: boolean;
  onSaved: (row: RuleRow, message: string) => void;
  onError: (message: string) => void;
}) {
  const [rule, setRule] = useState<Rule>(row.rule);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rule) !== JSON.stringify(row.rule);
  const missing = (['whatsapp', 'sms', 'email'] as Channel[]).filter((c) => !rule.channels.includes(c));
  const off = !row.alwaysOn && !rule.enabled;
  const isAvailable = (c: Channel) => available.find((a) => a.key === c)?.available !== false;

  async function save(next: Rule = rule) {
    setBusy(true);
    try {
      const r = await apiSend<{ data: RuleRow }>('PUT', `/settings/notification-rules/${row.key}`, next);
      onSaved(r.data, `${row.label}: saved.`);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const r = await apiSend<{ data: RuleRow }>('DELETE', `/settings/notification-rules/${row.key}`);
      onSaved(r.data, `${row.label}: back to the default.`);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const move = (i: number, dir: -1 | 1) =>
    setRule((r) => {
      const c = [...r.channels];
      const j = i + dir;
      if (j < 0 || j >= c.length) return r;
      [c[i], c[j]] = [c[j], c[i]];
      return { ...r, channels: c };
    });

  return (
    <div className={cx('rounded-xl border bg-surface p-4 sm:p-5', dirty ? 'border-indigo-300 dark:border-indigo-400/50' : 'border-line')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            {row.label}
            {row.alwaysOn ? <Badge>Sent when you ask</Badge> : off ? <Badge>Off</Badge> : <Badge tone="green">On</Badge>}
            {row.custom && <Badge tone="indigo">Customised</Badge>}
          </h3>
          <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">{row.description}</p>
        </div>
        {!row.alwaysOn && (
          <Switch
            checked={rule.enabled}
            disabled={!canEdit || busy}
            label={`Send "${row.label}"`}
            onChange={(enabled) => {
              const next = { ...rule, enabled };
              setRule(next);
              if (!dirty) save(next); // a lone on/off flip saves at once
            }}
          />
        )}
      </div>

      <div className={cx('mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)]', off && 'opacity-60')}>
        <div>
          <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Channels, in order</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {rule.channels.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-0.5">
                {i > 0 && <span className="mx-0.5 text-xs text-slate-400">then</span>}
                <ChannelChip channel={c} muted={!isAvailable(c)} />
                {canEdit && (
                  <span className="inline-flex">
                    {rule.channels.length > 1 && (
                      <>
                        <button type="button" aria-label={`Move ${CHANNEL_LABEL[c]} earlier`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200">
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button type="button" aria-label={`Move ${CHANNEL_LABEL[c]} later`} disabled={i === rule.channels.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200">
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button type="button" aria-label={`Remove ${CHANNEL_LABEL[c]}`} onClick={() => setRule((r) => ({ ...r, channels: r.channels.filter((x) => x !== c) }))} className="rounded p-0.5 text-slate-400 hover:text-red-600">
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </span>
                )}
              </span>
            ))}
            {canEdit &&
              missing.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setRule((r) => ({ ...r, channels: [...r.channels, c] }))}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                  <Plus className="h-3 w-3" aria-hidden /> {CHANNEL_LABEL[c]}
                </button>
              ))}
          </div>
          {rule.channels.some((c) => !isAvailable(c)) && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">Crossed-out channels are off for your school and are skipped.</p>}
          {rule.channels.length > 1 && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">The next channel is used only when the one before can&apos;t reach the parent.</p>}
        </div>

        <Select label="Send to" value={rule.audience} disabled={!canEdit} onChange={(e) => setRule((r) => ({ ...r, audience: e.target.value as Rule['audience'] }))}>
          <option value="guardians">Parents &amp; guardians</option>
          <option value="primary_parent">Primary parent only</option>
        </Select>

        <TimingEditor timing={rule.timing} modes={row.timingModes} disabled={!canEdit} onChange={(timing) => setRule((r) => ({ ...r, timing }))} eventKey={row.key} />
      </div>

      {canEdit && (dirty || row.custom) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {dirty && (
            <>
              <Button size="sm" loading={busy} onClick={() => save()} disabled={rule.channels.length === 0}>
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRule(row.rule)} disabled={busy}>
                Discard
              </Button>
            </>
          )}
          {row.custom && !dirty && (
            <Button size="sm" variant="ghost" icon={<RotateCcw aria-hidden />} onClick={reset} loading={busy}>
              Back to default
            </Button>
          )}
          {!dirty && <span className="text-xs text-slate-500">{describeTiming(rule.timing)}</span>}
        </div>
      )}
    </div>
  );
}

const MODE_LABEL: Record<Timing['mode'], string> = { immediate: 'Right away', delay: 'After a delay', at_time: 'At a fixed time', scheduled: 'Daily schedule' };

function TimingEditor({ timing, modes, onChange, disabled, eventKey }: { timing: Timing; modes: Timing['mode'][]; onChange: (t: Timing) => void; disabled: boolean; eventKey: string }) {
  const setMode = (mode: Timing['mode']) => {
    if (mode === 'immediate') onChange({ mode });
    else if (mode === 'delay') onChange({ mode, minutes: 30 });
    else if (mode === 'at_time') onChange({ mode, time: '10:30' });
    else onChange({ mode, time: '09:00', autoRun: true });
  };
  return (
    <div className="flex flex-col gap-2">
      {modes.length > 1 ? (
        <Select label="When" value={timing.mode} disabled={disabled} onChange={(e) => setMode(e.target.value as Timing['mode'])}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-13 font-medium text-slate-700 dark:text-slate-300">When</p>
      )}
      {timing.mode === 'immediate' && modes.length === 1 && <p className="text-sm text-slate-600 dark:text-slate-300">Right away</p>}
      {timing.mode === 'delay' && (
        <Input label="Minutes later" type="number" min={1} max={240} value={timing.minutes} disabled={disabled} onChange={(e) => onChange({ ...timing, minutes: Math.max(1, Math.min(240, Number(e.target.value) || 1)) })} hint="Gives the teacher time to correct a mistake before parents hear." />
      )}
      {timing.mode === 'at_time' && (
        <Input label="Time" type="time" value={timing.time} disabled={disabled} onChange={(e) => onChange({ ...timing, time: e.target.value })} hint={eventKey === 'absentee_alert' ? 'E.g. 10:30: late registers are in, corrections cancel the message.' : undefined} />
      )}
      {timing.mode === 'scheduled' && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-muted/60 p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-700 dark:text-slate-200">{eventKey === 'fee_due_reminder' ? 'Send automatically' : 'Send every day'}</span>
            <Switch size="sm" checked={timing.autoRun} disabled={disabled} label="Send automatically" onChange={(autoRun) => onChange({ ...timing, autoRun })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Input label="At" type="time" value={timing.time} disabled={disabled || !timing.autoRun} onChange={(e) => onChange({ ...timing, time: e.target.value })} />
            {eventKey === 'fee_due_reminder' && (
              <Input label="Every (days)" type="number" min={1} max={30} value={timing.everyDays ?? 1} disabled={disabled || !timing.autoRun} onChange={(e) => onChange({ ...timing, everyDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
            )}
          </div>
          {eventKey === 'fee_due_reminder' && (
            <>
              <Input label="Remind this many days before the due date" type="number" min={0} max={30} value={timing.daysBefore ?? 3} disabled={disabled} onChange={(e) => onChange({ ...timing, daysBefore: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="accent-indigo-600" checked={timing.includeOverdue ?? true} disabled={disabled} onChange={(e) => onChange({ ...timing, includeOverdue: e.target.checked })} />
                Also remind for overdue fees
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
