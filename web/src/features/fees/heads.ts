import { apiSend } from '@/lib/session';
import type { FeeHead, Frequency } from './setup/types';

/** A short code from a fee head name: "Annual picnic" -> "ANNUAL-PICNIC". */
export function suggestHeadCode(name: string): string {
  const code = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  return code || 'FEE';
}

/**
 * Creates a fee head from just a name (inline "New fee head…" in the Add fee / Add charge forms).
 * The code is derived from the name; if another head already uses it, a number is added.
 */
export async function createHeadInline(name: string, frequency: Frequency): Promise<FeeHead> {
  const base = suggestHeadCode(name);
  const body = (code: string) =>
    frequency === 'one_time' ? { name: name.trim(), code, type: 'one_time' } : { name: name.trim(), code, type: 'recurring', defaultFrequency: frequency };
  try {
    return (await apiSend<{ data: FeeHead }>('POST', '/fees/heads', body(base))).data;
  } catch (err) {
    if ((err as { code?: string }).code !== 'HEAD_CODE_TAKEN') throw err;
    const suffix = String(Math.floor(Math.random() * 900) + 100);
    return (await apiSend<{ data: FeeHead }>('POST', '/fees/heads', body(`${base.slice(0, 26)}-${suffix}`))).data;
  }
}
