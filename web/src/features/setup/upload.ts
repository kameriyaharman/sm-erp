'use client';

import { API_BASE, ApiError, getAccessToken } from '@/lib/session';

/**
 * PUT one picture as multipart/form-data ("file") to the API: student photos and the
 * school logo. Pictures are at most 2 MB, so no progress bar is needed.
 */
export async function uploadPicture<T = unknown>(path: string, file: File): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, body: form });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'The upload was interrupted. Check your connection and try again.', 0);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? `Upload failed (${res.status})`, res.status, payload?.error?.details);
  return payload as T;
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const LOGO_TYPES = ['image/jpeg', 'image/png'];

/** Client-side check before uploading (the server checks the bytes again). */
export function pictureError(file: File, { types, maxMb, label }: { types: string[]; maxMb: number; label: string }): string | null {
  if (!types.includes(file.type)) return `${label} must be a ${types.map((t) => t.split('/')[1].toUpperCase().replace('JPEG', 'JPG')).join(', ').replace(/, ([^,]*)$/, ' or $1')} image`;
  if (file.size === 0) return 'The file is empty';
  if (file.size > maxMb * 1024 * 1024) return `${label} can be at most ${maxMb} MB (this one is ${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  return null;
}
