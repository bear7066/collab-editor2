import React, { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { RenameResult } from '../lib/useBoardMeta';

interface BoardTitleProps {
  boardName: string;
  canRename: boolean;
  onRename: (newName: string) => Promise<RenameResult>;
}

/** Board names are also their URL, so renaming navigates to the new address. */
export const BoardTitle: React.FC<BoardTitleProps> = ({ boardName, canRename, onRename }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = (draft ?? '').trim().replace(/\s+/g, '-').toLowerCase();
    if (!cleanName || cleanName === boardName) {
      setDraft(null);
      return;
    }

    setIsSaving(true);
    const result = await onRename(cleanName);
    setIsSaving(false);
    if (result === 'ok') {
      setDraft(null);
      setError('');
      return;
    }
    setError(result === 'conflict' ? 'That name is taken.' : 'Could not rename.');
    // Keep the field focused so Escape still cancels and the name stays editable.
    inputRef.current?.focus();
  };

  if (draft === null) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="font-serif text-lg font-semibold text-ink truncate">/board/{boardName}</h1>
        {canRename && (
          <button
            type="button"
            onClick={() => {
              setDraft(boardName);
              setError('');
            }}
            className="shrink-0 rounded p-1 text-stone transition hover:text-ink cursor-pointer"
            title="Rename board"
            aria-label="Rename board"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 min-w-0">
      <span className="font-serif text-lg font-semibold text-stone shrink-0">/board/</span>
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        disabled={isSaving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setDraft(null);
            setError('');
          }
        }}
        onBlur={() => {
          // Blur cancels; saving goes through Enter so a stray click cannot rename.
          if (!isSaving) {
            setDraft(null);
            setError('');
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 font-serif text-lg text-ink outline-none focus:border-ai"
        aria-label="New board name"
      />
      {error && <span className="shrink-0 text-xs text-shu">{error}</span>}
    </form>
  );
};
