'use client';

/**
 * Homework attachments: a drop zone + "Add files" button, a list of picked files with live upload
 * status, and the "Files" modal for homework that already exists. Client-side checks mirror the API
 * (allowed types, 5 MB each, 5 per homework) so teachers see a clear message before uploading.
 */

import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { CircleCheck, LoaderCircle, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import { Button, Modal, Notice, cx } from '@/components/ui';
import { AttachmentChip, FileTypeIcon } from '@/components/Attachments';
import { apiSend, apiUpload } from '@/lib/session';
import { ACCEPT_ATTR, MAX_FILES, checkFile, formatBytes, friendlyError } from '@/lib/access';
import type { HomeworkAttachment, HomeworkRow } from './types';

export type UploadStatus = 'ready' | 'uploading' | 'done' | 'failed';
export interface PendingFile {
  key: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
}

let seq = 0;

/** Picked files and their upload state. `limit` = how many more files the homework can take. */
export function useFileQueue(limit: number) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;

  const add = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list);
      const problems: string[] = [];
      // Computed outside the state updater: updaters may run twice (React strict mode).
      const next = [...filesRef.current];
      for (const file of incoming) {
        const problem = checkFile(file);
        if (problem) {
          if (!problems.includes(problem)) problems.push(problem);
          continue;
        }
        if (next.some((p) => p.file.name === file.name && p.file.size === file.size && p.status !== 'done')) continue;
        if (next.filter((p) => p.status !== 'done').length >= limit) {
          problems.push(`${file.name} was not added: a homework can have at most ${MAX_FILES} files${limit < MAX_FILES ? ` (${MAX_FILES - limit} already attached)` : ''}.`);
          continue;
        }
        next.push({ key: `f${++seq}`, file, status: 'ready', progress: 0, error: null });
      }
      filesRef.current = next;
      setFiles(next);
      setRejected(problems);
    },
    [limit],
  );

  const remove = useCallback((key: string) => setFiles((prev) => prev.filter((p) => p.key !== key)), []);
  const patch = useCallback((key: string, change: Partial<PendingFile>) => setFiles((prev) => prev.map((p) => (p.key === key ? { ...p, ...change } : p))), []);

  /** Uploads every file that is ready or failed, one at a time. Returns the uploaded attachments and how many failed. */
  const uploadAll = useCallback(
    async (homeworkId: string, only?: string): Promise<{ uploaded: HomeworkAttachment[]; failed: number }> => {
      const uploaded: HomeworkAttachment[] = [];
      let failed = 0;
      const snapshot = filesRef.current;
      for (const item of snapshot) {
        if (item.status === 'done' || (only && item.key !== only)) continue;
        patch(item.key, { status: 'uploading', progress: 0, error: null });
        try {
          const res = await apiUpload<{ data: HomeworkAttachment }>(`/homework/${homeworkId}/attachments`, item.file, 'file', (f) => patch(item.key, { progress: f }));
          patch(item.key, { status: 'done', progress: 1 });
          uploaded.push(res.data);
        } catch (e) {
          failed += 1;
          patch(item.key, { status: 'failed', error: friendlyError(e) });
        }
      }
      return { uploaded, failed };
    },
    [patch],
  );

  return { files, rejected, add, remove, uploadAll, clearRejected: () => setRejected([]), setFiles };
}

/** Drag-and-drop area with an "Add files" button. */
export function FileDropZone({ onFiles, disabled, remaining }: { onFiles: (files: FileList) => void; disabled?: boolean; remaining: number }) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = remaining <= 0;

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!disabled && !full && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !full) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors sm:flex-row sm:text-left',
        over ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-400/10' : 'border-line-strong bg-surface-muted/60',
        (disabled || full) && 'opacity-70',
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-slate-400 ring-1 ring-inset ring-line dark:text-slate-500">
        <Upload className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{full ? `${MAX_FILES} files attached (the maximum)` : 'Drag files here, or add them from your device'}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">PDF, images, Word, Excel, PowerPoint or TXT. Up to 5 MB each, {MAX_FILES} files per homework.</p>
      </div>
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-label="Attach files"
        disabled={disabled || full}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <Button variant="secondary" size="sm" icon={<Paperclip aria-hidden />} onClick={() => input.current?.click()} disabled={disabled || full}>
        Add files
      </Button>
    </div>
  );
}

/** The picked files: type icon, name, size, status, remove / retry. */
export function PendingFileList({ files, onRemove, onRetry, locked }: { files: PendingFile[]; onRemove: (key: string) => void; onRetry?: (key: string) => void; locked?: boolean }) {
  if (!files.length) return null;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Files to attach">
      {files.map((f) => (
        <li key={f.key} className="flex items-center gap-3 px-3 py-2.5">
          <FileTypeIcon name={f.file.name} mimeType={f.file.type} className="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.file.name}</p>
            <p className={cx('text-xs', f.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>
              {f.status === 'failed' ? (
                <>Not uploaded: {f.error}</>
              ) : f.status === 'uploading' ? (
                <span className="tabular-nums">Uploading {Math.round(f.progress * 100)}% of {formatBytes(f.file.size)}</span>
              ) : f.status === 'done' ? (
                <>Uploaded, {formatBytes(f.file.size)}</>
              ) : (
                formatBytes(f.file.size)
              )}
            </p>
            {f.status === 'uploading' && (
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={`Uploading ${f.file.name}`} aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span className="block h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(4, f.progress * 100)}%` }} />
              </span>
            )}
          </div>
          {f.status === 'uploading' && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-indigo-500" aria-hidden />}
          {f.status === 'done' && <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Uploaded" />}
          {f.status === 'failed' && onRetry && (
            <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden />} onClick={() => onRetry(f.key)} aria-label={`Retry ${f.file.name}`}>
              Retry
            </Button>
          )}
          {(f.status === 'ready' || f.status === 'failed') && !locked && (
            <button
              type="button"
              onClick={() => onRemove(f.key)}
              aria-label={`Remove ${f.file.name}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RejectedFiles({ messages, onDismiss }: { messages: string[]; onDismiss: () => void }) {
  if (!messages.length) return null;
  return (
    <Notice tone="error">
      <div className="flex items-start justify-between gap-3">
        <ul className="min-w-0 space-y-0.5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-medium underline-offset-2 hover:underline">
          Dismiss
        </button>
      </div>
    </Notice>
  );
}

/** "Files" for an existing homework: open, remove and add attachments (only shown when canEdit). */
export function EditAttachmentsModal({ item, onClose, onChanged }: { item: HomeworkRow; onClose: () => void; onChanged: (attachments: HomeworkAttachment[]) => void }) {
  const [current, setCurrent] = useState<HomeworkAttachment[]>(item.attachments ?? []);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useFileQueue(MAX_FILES - current.length);
  const [uploading, setUploading] = useState(false);
  const pending = queue.files.filter((f) => f.status !== 'done');

  async function remove(a: HomeworkAttachment) {
    setRemoving(a.id);
    setError(null);
    try {
      await apiSend('DELETE', `/homework/attachments/${a.id}`);
      const next = current.filter((x) => x.id !== a.id);
      setCurrent(next);
      onChanged(next);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setRemoving(null);
    }
  }

  async function upload(only?: string) {
    setUploading(true);
    setError(null);
    const { uploaded, failed } = await queue.uploadAll(item.id, only);
    const next = [...current, ...uploaded];
    setCurrent(next);
    if (uploaded.length) onChanged(next);
    // Drop the uploaded rows from the queue; they now show as attachments above.
    queue.setFiles((prev) => prev.filter((p) => p.status !== 'done'));
    if (failed) setError(`${failed} file${failed === 1 ? '' : 's'} could not be uploaded. Retry, or remove ${failed === 1 ? 'it' : 'them'}.`);
    setUploading(false);
  }

  return (
    <Modal
      open
      title="Homework files"
      description={`${item.title}, ${item.section.label}`}
      onClose={uploading ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            Done
          </Button>
          <Button onClick={() => upload()} loading={uploading} disabled={!pending.length} icon={<Upload aria-hidden />}>
            Upload {pending.length ? `${pending.length} file${pending.length === 1 ? '' : 's'}` : 'files'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <p className="mb-2 text-13 font-medium text-slate-700 dark:text-slate-300">Attached ({current.length} of {MAX_FILES})</p>
          {current.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No files attached yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {current.map((a) => (
                <AttachmentChip key={a.id} file={{ url: a.url, name: a.fileName, sizeBytes: a.sizeBytes, mimeType: a.mimeType }} onRemove={() => remove(a)} removing={removing === a.id} />
              ))}
            </div>
          )}
        </div>
        <FileDropZone onFiles={queue.add} disabled={uploading} remaining={MAX_FILES - current.length - pending.length} />
        <RejectedFiles messages={queue.rejected} onDismiss={queue.clearRejected} />
        <PendingFileList files={queue.files} onRemove={queue.remove} onRetry={(key) => upload(key)} locked={uploading} />
      </div>
    </Modal>
  );
}
