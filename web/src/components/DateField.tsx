'use client';

/**
 * Date input that always shows DD-MM-YYYY (Indian format), whatever the browser locale.
 * Value in/out is ISO "YYYY-MM-DD" (or '' when empty), same as <input type="date">.
 * Type the date, or press the calendar button to use the browser's own picker.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Field, cx } from './ui';

export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** "5/4/2026", "05-04-2026", "05.04.26" -> "2026-04-05"; null when not a real date. */
export function displayToIso(text: string): string | null {
  const m = /^\s*(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DateField({
  value,
  onChange,
  label,
  hint,
  error,
  id,
  min,
  max,
  disabled,
  required,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  hint?: string;
  error?: string | null;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const native = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(isoToDisplay(value));
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setText(isoToDisplay(value));
    setBad(false);
  }, [value]);

  function commit(raw: string) {
    if (raw.trim() === '') {
      setBad(false);
      if (value !== '') onChange('');
      return;
    }
    const iso = displayToIso(raw);
    if (!iso || (min && iso < min) || (max && iso > max)) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(isoToDisplay(iso));
    if (iso !== value) onChange(iso);
  }

  const shownError = error ?? (bad ? 'Enter a date as DD-MM-YYYY' : null);
  const control = (
    <div className={cx('relative', !label && className)}>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD-MM-YYYY"
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={shownError ? true : undefined}
        disabled={disabled}
        required={required}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        className={cx(
          'block h-10 w-full rounded-lg border bg-white pl-3 pr-10 text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 sm:h-9',
          shownError ? 'border-red-500' : 'border-slate-300 focus:border-indigo-500 dark:border-slate-700',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        onClick={() => {
          const el = native.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.click();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-indigo-600 disabled:opacity-50"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
      </button>
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </div>
  );
  return label ? (
    <Field label={label} hint={hint} error={shownError} htmlFor={inputId} className={className}>
      {control}
    </Field>
  ) : (
    control
  );
}
