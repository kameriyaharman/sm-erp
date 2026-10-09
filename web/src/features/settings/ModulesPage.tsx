'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Badge, Card, ErrorState, Notice, Page, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { refreshEntitlements } from '@/lib/entitlements';
import { errorCode, errorText, useFlash } from '@/features/admin/shared';
import { SaveBar, SettingsHeader, Switch } from './bits';
import type { ModulesData } from './types';

/**
 * Settings -> Modules. Core modules are always on; modules outside the plan are shown locked.
 * Switching a module off hides it from every menu and the API refuses its screens; data is kept,
 * so switching it back on brings everything back.
 */
export default function ModulesPage() {
  const { data, error, loading, reload, setData } = useApi<{ data: ModulesData }>('/settings/modules');
  const flash = useFlash();
  const d = data?.data;
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const saved = useMemo(() => new Set<string>((d?.modules ?? []).filter((m) => m.inPlan && !m.core && !m.enabled).map((m) => m.key)), [d]);
  useEffect(() => setOff(new Set(saved)), [saved]);
  const dirty = d ? saved.size !== off.size || [...off].some((k) => !saved.has(k)) : false;

  async function save() {
    if (!d) return;
    setBusy(true);
    try {
      const res = await apiSend<{ data: ModulesData }>('PUT', '/settings/modules', { disabled: [...off], version: d.version });
      setData(res);
      await refreshEntitlements();
      flash.show('success', 'Saved. Menus update for everyone within a minute.');
    } catch (err) {
      flash.show('error', errorCode(err) === 'SETTINGS_CHANGED' ? 'Someone else changed the modules meanwhile. Reload and try again.' : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const out = new Map<string, ModulesData['modules']>();
    for (const m of d?.modules ?? []) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return [...out];
  }, [d]);

  return (
    <Page>
      <SettingsHeader
        title="Modules"
        description={
          <>
            Switch off what your school doesn&apos;t use: it disappears from menus and the parent app. Nothing is deleted.
            {d?.plan && (
              <>
                {' '}
                Your plan: <span className="font-medium text-slate-700 dark:text-slate-200">{d.plan.name}</span>.
              </>
            )}
          </>
        }
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !d ? (
        <Spinner label="Loading modules" />
      ) : d ? (
        <>
          {!d.canEdit && (
            <div className="mb-5">
              <Notice>Only the school owner can switch modules on or off.</Notice>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            {groups.map(([group, mods]) => (
              <Card key={group} title={group} padded={false}>
                <ul className="divide-y divide-line">
                  {mods.map((m) => {
                    const on = m.core || (m.inPlan && !off.has(m.key));
                    return (
                      <li key={m.key} className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                            {m.label}
                            {m.core && <Badge>Always on</Badge>}
                            {!m.inPlan && (
                              <Badge tone="amber">
                                <Lock className="h-3 w-3" aria-hidden /> Not in your plan
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">{m.description}</p>
                        </div>
                        <Switch
                          checked={on}
                          disabled={m.core || !m.inPlan || !d.canEdit}
                          label={m.label}
                          onChange={(next) =>
                            setOff((s) => {
                              const n = new Set(s);
                              if (next) n.delete(m.key);
                              else n.add(m.key);
                              return n;
                            })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
          <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setOff(new Set(saved))} />
        </>
      ) : null}
    </Page>
  );
}
