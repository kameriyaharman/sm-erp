'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { initials } from '@/features/admin/shared';
import { useAuthImage } from '../useAuthImage';
import { PHOTO_TYPES, pictureError } from '../upload';

/**
 * Passport photo for the student form: shows the chosen file (or the photo on record) with
 * Change / Remove. The file is uploaded by the form after the student is saved.
 */
export default function PhotoPicker({
  name,
  existing,
  file,
  onFile,
  onRemoveExisting,
}: {
  name: string;
  existing: { path: string; version: string } | null;
  file: File | null;
  onFile: (f: File | null) => void;
  onRemoveExisting: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useAuthImage(existing?.path, existing?.version);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = preview ?? (existing ? current.url : null);

  return (
    <div className="flex shrink-0 flex-row items-center gap-4 sm:w-36 sm:flex-col sm:items-stretch">
      <div className="relative flex h-32 w-[6.5rem] items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-surface-muted sm:h-44 sm:w-full">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={`Photo of ${name || 'the student'}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-slate-400 dark:text-slate-500">
            {name ? <span className="text-2xl font-semibold text-slate-300 dark:text-slate-600">{initials(name)}</span> : <Camera className="h-7 w-7" aria-hidden />}
            <span className="text-xs">Passport photo</span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          className="sr-only"
          aria-label="Choose a photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const problem = pictureError(f, { types: PHOTO_TYPES, maxMb: 2, label: 'The photo' });
            setError(problem);
            if (!problem) onFile(f);
          }}
        />
        <Button size="sm" variant="secondary" icon={<Camera aria-hidden />} onClick={() => input.current?.click()}>
          {shown ? 'Change photo' : 'Add photo'}
        </Button>
        {(file || (existing && current.url)) && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 aria-hidden />}
            onClick={() => {
              setError(null);
              if (file) onFile(null);
              else onRemoveExisting();
            }}
          >
            Remove
          </Button>
        )}
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : <p className="text-xs text-slate-500 dark:text-slate-400">JPG, PNG or WebP, up to 2 MB</p>}
      </div>
    </div>
  );
}
