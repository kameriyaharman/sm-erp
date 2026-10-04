'use client';

/**
 * Shared building blocks for the staff screens (admin, owner, teacher).
 *
 * Design system "the school register": ink-navy chrome, cool-white surfaces, brand blue
 * (Tailwind `indigo`, remapped) for actions, marigold only for "today / you are here".
 * Radii: controls 8px (rounded-lg), cards 12px (rounded-xl), modals 16px (rounded-2xl).
 * Cards are flat (1px border, no shadow); only floating things get a shadow.
 * Every screen should use these so spacing, focus, dark mode and empty/error states match.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Info, Inbox, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Class strings for places that cannot use the components (custom markup in features). */
export const surfaceClass = 'rounded-xl border border-line bg-surface';
export const labelClass = 'text-13 font-medium text-slate-500 dark:text-slate-400';

// ------------------------------------------------------------------ page layout

export function Page({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <main className={cx('mx-auto w-full px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-8', wide ? 'max-w-[1536px]' : 'max-w-content', className)}>{children}</main>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  /** Small trail above the title, e.g. <Link>Students</Link>. */
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 lg:mb-8">
      {(back || breadcrumb) && <div className="mb-3 flex items-center gap-2 text-13 text-slate-500 dark:text-slate-400">{back ?? breadcrumb}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
          {description && <div className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  description,
  actions,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={cx(surfaceClass, 'min-w-0', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-6 text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="text-13 text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

const STAT_TONE = {
  default: 'text-slate-900 dark:text-white',
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
};

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  delta,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  /** Small icon shown before the label. */
  icon?: ReactNode;
  /** Change vs a comparison period; `good` decides the colour. */
  delta?: { value: string; direction: 'up' | 'down'; good: boolean };
}) {
  const DeltaIcon = delta?.direction === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <div className={cx(surfaceClass, 'min-w-0 p-4 sm:p-5')}>
      <p className={cx('flex items-center gap-2', labelClass)}>
        {icon && <span className="text-slate-400 dark:text-slate-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <span className="truncate">{label}</span>
      </p>
      <p className={cx('mt-2 text-2xl font-semibold leading-8 tracking-tight tabular-nums', STAT_TONE[tone])}>{value}</p>
      {(hint || delta) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-13 text-slate-500 dark:text-slate-400">
          {delta && (
            <span className={cx('inline-flex items-center gap-0.5 font-medium tabular-nums', delta.good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta.value}
            </span>
          )}
          {hint}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ buttons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-300 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-900 dark:disabled:text-indigo-300',
  secondary:
    'border border-line-strong bg-surface text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5 dark:hover:border-line-strong',
  ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-white/5',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300 dark:disabled:bg-red-900',
};
const BUTTON_SIZE = {
  sm: 'h-8 gap-1.5 px-2.5 text-13 [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'h-10 gap-2 px-3.5 text-sm sm:h-9 [&>svg]:h-4 [&>svg]:w-4',
  lg: 'h-11 gap-2 px-5 text-[15px] [&>svg]:h-[18px] [&>svg]:w-[18px]',
};
const ICON_ONLY = { sm: 'w-8 px-0', md: 'w-10 px-0 sm:w-9', lg: 'w-11 px-0' };

export function buttonClass({ variant = 'primary', size = 'md', iconOnly = false }: { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; iconOnly?: boolean } = {}) {
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
    BUTTON_SIZE[size],
    iconOnly && ICON_ONLY[size],
    BUTTON[variant],
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  // Icon-only buttons (no children) are square; give them an aria-label.
  const iconOnly = !children && Boolean(icon);
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx(buttonClass({ variant, size, iconOnly }), className)} {...rest}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ form fields

export const controlClass =
  'block w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] hover:border-slate-400/70 focus:border-indigo-500 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20 dark:disabled:bg-white/5';
const CONTROL = controlClass;
const CONTROL_H = 'h-10 sm:h-9';
const CONTROL_ERROR = 'border-red-500 hover:border-red-500 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500';

export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode; error?: string | null }) {
  const auto = useId();
  const inputId = id ?? auto;
  const control = <input id={inputId} aria-invalid={error ? true : undefined} className={cx(CONTROL, CONTROL_H, error && CONTROL_ERROR, !label && className)} {...rest} />;
  return label ? (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={className}>
      {control}
    </Field>
  ) : (
    control
  );
}

/** Search box with a leading icon. `label` is visually hidden unless `showLabel`. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; showLabel?: boolean; containerClassName?: string }>(
  function SearchInput({ label, showLabel = false, containerClassName, className, id, ...rest }, ref) {
    const auto = useId();
    const inputId = id ?? auto;
    return (
      <div className={containerClassName}>
        <label htmlFor={inputId} className={showLabel ? 'mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300' : 'sr-only'}>
          {label}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input ref={ref} id={inputId} type="search" className={cx(CONTROL, CONTROL_H, 'pl-9', className)} {...rest} />
        </div>
      </div>
    );
  },
);

export function Select({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: ReactNode; error?: string | null }) {
  const auto = useId();
  const selectId = id ?? auto;
  const control = (
    <select id={selectId} aria-invalid={error ? true : undefined} className={cx(CONTROL, CONTROL_H, 'pr-9', error && CONTROL_ERROR, !label && className)} {...rest}>
      {children}
    </select>
  );
  return label ? (
    <Field label={label} hint={hint} error={error} htmlFor={selectId} className={className}>
      {control}
    </Field>
  ) : (
    control
  );
}

export function Textarea({ label, hint, error, className, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: ReactNode; error?: string | null }) {
  const auto = useId();
  const areaId = id ?? auto;
  const control = <textarea id={areaId} aria-invalid={error ? true : undefined} className={cx(CONTROL, 'py-2 leading-6', error && CONTROL_ERROR, !label && className)} rows={4} {...rest} />;
  return label ? (
    <Field label={label} hint={hint} error={error} htmlFor={areaId} className={className}>
      {control}
    </Field>
  ) : (
    control
  );
}

// ------------------------------------------------------------------ tables

/**
 * Data table. Header row is sticky inside the table's own scroll box (give `className`
 * a max-height, e.g. "max-h-[70vh]", to scroll long lists with the header pinned).
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // relative: keeps absolutely positioned children (sr-only labels) inside the scroll box on phones
    <div className={cx('relative overflow-x-auto', className)}>
      <table className="w-full min-w-full border-collapse text-sm [&_tbody_tr:last-child>td]:border-b-0 [&_tbody_tr:last-child>th]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50/70 dark:[&_tbody_tr:hover]:bg-white/[0.025]">
        {children}
      </table>
    </div>
  );
}
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cx(
        'sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface-muted px-4 py-2.5 text-13 font-medium text-slate-500 first:pl-4 last:pr-4 dark:text-slate-400 sm:first:pl-5 sm:last:pr-5',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cx(
        'border-b border-line px-4 py-3 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
        align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : '',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ------------------------------------------------------------------ status

const BADGE = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-white/[0.07] dark:text-slate-300',
  green: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200',
};
const BADGE_DOT = { gray: 'bg-slate-400', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', indigo: 'bg-indigo-500' };
export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = 'gray', children, dot = false }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium', BADGE[tone])}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', BADGE_DOT[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Grey placeholder block for loading layouts. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('block animate-pulse rounded-lg bg-slate-200/70 dark:bg-white/[0.06]', className)} />;
}

export function Spinner({ label = 'Loading…', skeleton = false }: { label?: string; /** Show placeholder rows instead of a spinner. */ skeleton?: boolean }) {
  if (skeleton) {
    return (
      <div role="status" className="space-y-3 p-5">
        <span className="sr-only">{label}</span>
        {[72, 88, 64, 80, 56].map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <span className="block" style={{ width: `${w}%` }}>
                <Skeleton className="h-3.5" />
              </span>
              <span className="block" style={{ width: `${w / 2}%` }}>
                <Skeleton className="h-3" />
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-14 text-sm text-slate-500 dark:text-slate-400">
      <LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-400">
        <CircleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">Something went wrong</p>
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/[0.06] dark:text-slate-500 [&>svg]:h-5 [&>svg]:w-5">
        {icon ?? <Inbox aria-hidden />}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

const NOTICE = {
  info: { cls: 'border-indigo-200 bg-indigo-50/70 text-indigo-900 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-100', icon: Info, iconCls: 'text-indigo-600 dark:text-indigo-300' },
  success: { cls: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100', icon: CircleCheck, iconCls: 'text-emerald-600 dark:text-emerald-400' },
  error: { cls: 'border-red-200 bg-red-50/70 text-red-900 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-100', icon: CircleAlert, iconCls: 'text-red-600 dark:text-red-400' },
  warn: { cls: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100', icon: TriangleAlert, iconCls: 'text-amber-600 dark:text-amber-400' },
};

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error' | 'warn'; children: ReactNode }) {
  const n = NOTICE[tone];
  const Icon = n.icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm', n.cls)}>
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', n.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  description,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** xl: wide grids (e.g. the subject assignment matrix). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  description?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Latest onClose without re-running the open effect: callers often pass an inline arrow, and
  // re-running would move focus back to the first field on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the top-most dialog closes (a confirm opened from inside another dialog).
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 1 && dialogs[dialogs.length - 1] !== ref.current) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-ink-950/45 p-0 backdrop-blur-[1px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl',
          { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size],
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 dark:bg-white/10 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-0.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-1 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-muted/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:px-6 sm:pb-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tabs

/** Segmented tabs. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode }> }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-max gap-0.5 rounded-[10px] border border-line bg-slate-100/80 p-[3px] dark:bg-white/[0.04]">
        {items.map((item) => {
          const selected = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.value)}
              className={cx(
                'h-8 shrink-0 rounded-[7px] px-3 text-13 font-medium transition-colors',
                selected
                  ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(14_26_51/0.08),0_0_0_1px_rgb(14_26_51/0.04)] dark:bg-white/10 dark:text-white dark:shadow-none'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-13 sm:px-5">
      <span className="tabular-nums text-slate-500 dark:text-slate-400">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft aria-hidden />}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
