import React from 'react';
import { Lock, Users } from 'lucide-react';
import type { Visibility } from '../lib/useBoardMeta';

const LABEL: Record<Visibility, string> = { personal: 'Personal', collab: 'Collab' };

interface BoardVisibilityProps {
  visibility: Visibility;
  isOwner: boolean;
  onToggle: (next: Visibility) => void;
}

const BASE = 'flex items-center gap-2 bg-surface border border-line rounded-xl py-1.5 px-3 text-xs font-medium';

/** Shows whether the board is personal or collab; its owner can switch. */
export const BoardVisibility: React.FC<BoardVisibilityProps> = ({ visibility, isOwner, onToggle }) => {
  const icon = visibility === 'personal' ? <Lock size={13} /> : <Users size={13} />;

  if (!isOwner) {
    return (
      <span className={`${BASE} text-stone`}>
        {icon}
        <span className="text-ink-soft">{LABEL[visibility]}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(visibility === 'personal' ? 'collab' : 'personal')}
      title={
        visibility === 'personal'
          ? 'Only you can open this board. Click to share it.'
          : 'Everyone signed in can open this board. Click to make it personal.'
      }
      className={`${BASE} text-stone transition hover:border-moss/60 hover:text-ink cursor-pointer`}
    >
      {icon}
      <span className="text-ink-soft">{LABEL[visibility]}</span>
    </button>
  );
};
