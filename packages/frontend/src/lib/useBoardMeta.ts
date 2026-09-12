import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from '../components/auth/AuthGate';

export type Visibility = 'personal' | 'collab';

export interface BoardMeta {
  visibility: Visibility;
  ownerId: number | null;
  isOwner: boolean;
}

export type RenameResult = 'ok' | 'conflict' | 'error';

interface BoardListEntry {
  name: string;
  visibility: Visibility;
  ownerId: number | null;
}

/**
 * Ownership and visibility for one board, read from the listing (which already
 * returns only what this user may see) and changed through the same endpoint.
 */
export function useBoardMeta(boardName: string) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<BoardMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiFetch('/api/boards');
        if (!response.ok) return;
        const boards = (await response.json()) as BoardListEntry[];
        const entry = boards.find((board) => board.name === boardName);
        if (!cancelled) {
          setMeta(entry ? { visibility: entry.visibility, ownerId: entry.ownerId, isOwner: entry.ownerId === user.id } : null);
        }
      } catch {
        // Leave the extras out rather than interrupt the board itself.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [boardName, user.id]);

  const patch = useCallback(
    (body: Record<string, unknown>) =>
      apiFetch('/api/boards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: boardName, ...body }),
      }),
    [boardName]
  );

  const setVisibility = useCallback(
    async (next: Visibility) => {
      if (!meta) return;
      const previous = meta;
      setMeta({ ...meta, visibility: next });
      try {
        const response = await patch({ visibility: next });
        if (!response.ok) setMeta(previous);
      } catch {
        setMeta(previous);
      }
    },
    [meta, patch]
  );

  const rename = useCallback(
    async (newName: string): Promise<RenameResult> => {
      try {
        const response = await patch({ newName });
        if (response.ok) return 'ok';
        return response.status === 409 ? 'conflict' : 'error';
      } catch {
        return 'error';
      }
    },
    [patch]
  );

  return { meta, setVisibility, rename };
}
