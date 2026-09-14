import { apiFetch } from './api';

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Uploads a file to a board's attachment store; throws on rejection (e.g. over the size limit). */
export async function uploadFile(boardName: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.set('file', file);
  const response = await apiFetch(`/api/files?board=${encodeURIComponent(boardName)}`, { method: 'POST', body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Upload failed (${response.status})`);
  }
  return response.json();
}

export const fileUrl = (id: string) => `/api/files?id=${encodeURIComponent(id)}`;

export async function deleteFile(id: string): Promise<void> {
  const response = await apiFetch(fileUrl(id), { method: 'DELETE' });
  // Missing bytes are already the desired final state; other failures should
  // leave the attachment metadata visible so the user can retry.
  if (!response.ok && response.status !== 404) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Delete failed (${response.status})`);
  }
}
