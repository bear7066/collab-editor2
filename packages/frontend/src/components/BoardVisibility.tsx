import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Users } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from './auth/AuthGate';
import type { Visibility } from './Dashboard';

interface BoardListEntry {
  name: string;
  visibility: Visibility;
  ownerId: number | null;
}

const LABEL: Record<Visibility, string> = { personal: 'Personal', collab: 'Collab' };

/**
 * Shows whether this board is personal or collab, and lets its owner switch.
 * The listing is the source of truth: it already returns only boards this user
 * may see, with their owner and visibility.
 */
export const BoardVisibility: React.FC<{ boardName: string }> = ({ boardName }) => {
  const { user } = useAuth();
  const [entry, setEntry] = useState<BoardListEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiFetch('/api/boards');
        if (!response.ok) return;
        const boards = (await response.json()) as BoardListEntry[];
        if (!cancelled) setEntry(boards.find((board) => board.name === boardName) ?? null);
      } catch {
        // Leave the badge out rather than interrupt the board.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [boardName]);

  const toggle = useCallback(async () => {
    if (!entry || isSaving) return;
    const next: Visibility = entry.visibility === 'personal' ? 'collab' : 'personal';
    setIsSaving(true);
    setEntry({ ...entry, visibility: next });
    try {
      const response = await apiFetch('/api/boards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: boardName, visibility: next }),
      });
      if (!response.ok) setEntry(entry);
    } catch {
      setEntry(entry);
    } finally {
      setIsSaving(false);
    }
  }, [boardName, entry, isSaving]);

  if (!entry) return null;

  const isOwner = entry.ownerId === user.id;
  const icon = entry.visibility === 'personal' ? <Lock size={13} /> : <Users size={13} />;
  const className = 'flex items-center gap-2 bg-surface border border-line rounded-xl py-1.5 px-3 text-xs font-medium';

  if (!isOwner) {
    return (
      <span className={`${className} text-stone`}>
        {icon}
        <span className="text-ink-soft">{LABEL[entry.visibility]}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isSaving}
      title={entry.visibility === 'personal' ? 'Only you can open this board. Click to share it.' : 'Everyone signed in can open this board. Click to make it personal.'}
      className={`${className} text-stone transition hover:border-moss/60 hover:text-ink cursor-pointer disabled:cursor-wait`}
    >
      {icon}
      <span className="text-ink-soft">{LABEL[entry.visibility]}</span>
    </button>
  );
};
