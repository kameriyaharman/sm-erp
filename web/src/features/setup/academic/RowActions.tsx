'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';

/** Edit / delete icon buttons for a row; labels name the item for screen readers. */
export function RowActions({ label, onEdit, onDelete }: { label: string; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {onEdit && <Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={onEdit} />}
      {onDelete && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 aria-hidden />}
          aria-label={`Delete ${label}`}
          title={`Delete ${label}`}
          onClick={onDelete}
          className="text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/10 dark:hover:text-red-300"
        />
      )}
    </span>
  );
}
