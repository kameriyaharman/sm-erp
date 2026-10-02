'use client';

import { useState } from 'react';
import { File, FileImage, FileSpreadsheet, FileText, LoaderCircle, Presentation, X, type LucideIcon } from 'lucide-react';
import { downloadFile } from '@/lib/session';
import { fileKind, formatBytes, friendlyError, type FileKind } from '@/lib/access';
import { cx } from './ui';

const KIND: Record<FileKind, { icon: LucideIcon; tint: string; label: string }> = {
  pdf: { icon: FileText, tint: 'text-red-600 dark:text-red-400', label: 'PDF' },
  image: { icon: FileImage, tint: 'text-emerald-600 dark:text-emerald-400', label: 'Image' },
  doc: { icon: FileText, tint: 'text-indigo-600 dark:text-indigo-300', label: 'Word document' },
  sheet: { icon: FileSpreadsheet, tint: 'text-emerald-700 dark:text-emerald-400', label: 'Spreadsheet' },
  slides: { icon: Presentation, tint: 'text-amber-600 dark:text-amber-400', label: 'Slides' },
  text: { icon: FileText, tint: 'text-slate-500 dark:text-slate-400', label: 'Text file' },
  other: { icon: File, tint: 'text-slate-500 dark:text-slate-400', label: 'File' },
};

export function FileTypeIcon({ name, mimeType, className }: { name: string; mimeType?: string | null; className?: string }) {
  const k = KIND[fileKind(name, mimeType)];
  const Icon = k.icon;
  return <Icon className={cx('shrink-0', k.tint, className ?? 'h-4 w-4')} aria-hidden />;
}

export function fileKindLabel(name: string, mimeType?: string | null): string {
  return KIND[fileKind(name, mimeType)].label;
}

export interface AttachmentRef {
  /** API path, e.g. "/api/v1/homework/attachments/<id>". */
  url: string;
  name: string;
  sizeBytes?: number | null;
  mimeType?: string | null;
}

/**
 * A tappable file chip: icon by type, name, size. Tapping fetches the file with the user's token
 * (opens PDFs and images in a new tab, saves other types). Errors show under the chip.
 * `variant="parent"` uses the parent app's warmer palette and a larger touch target.
 */
export function AttachmentChip({ file, variant = 'staff', onRemove, removing = false }: { file: AttachmentRef; variant?: 'staff' | 'parent'; onRemove?: () => void; removing?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = typeof file.sizeBytes === 'number' ? formatBytes(file.sizeBytes) : null;

  async function open() {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(file.url, file.name, file.mimeType);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const parent = variant === 'parent';
  return (
    <span className="inline-flex min-w-0 max-w-full flex-col">
      <span
        className={cx(
          'inline-flex min-w-0 max-w-full items-center rounded-lg ring-1 ring-inset transition-colors',
          parent
            ? 'bg-stone-50 ring-stone-200 hover:bg-stone-100 dark:bg-canvas dark:ring-line dark:hover:bg-white/5'
            : 'bg-surface ring-line-strong hover:bg-slate-50 dark:hover:bg-white/5',
        )}
      >
        <button
          type="button"
          onClick={open}
          disabled={busy}
          title={`Open ${file.name}`}
          aria-label={`${parent ? 'Open' : 'Download'} ${file.name}${size ? `, ${size}` : ''}`}
          className={cx(
            'inline-flex min-w-0 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            parent ? 'min-h-11 px-3 py-2 text-sm' : 'h-8 px-2.5 text-13',
          )}
        >
          {busy ? <LoaderCircle className={cx('shrink-0 animate-spin text-indigo-500', parent ? 'h-[18px] w-[18px]' : 'h-4 w-4')} aria-hidden /> : <FileTypeIcon name={file.name} mimeType={file.mimeType} className={parent ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />}
          <span className={cx('min-w-0 truncate font-medium', parent ? 'max-w-[13rem] sm:max-w-[18rem]' : 'max-w-[14rem]')}>{file.name}</span>
          {size && <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{size}</span>}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            aria-label={`Remove ${file.name}`}
            title="Remove file"
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-400/10 dark:hover:text-red-400"
          >
            {removing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
      </span>
      {error && (
        <span role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
