import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Calendar, Github, LogOut, Lock, Users } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from './auth/AuthGate';
import { ThemeToggle } from './ThemeToggle';

export type Visibility = 'personal' | 'collab';

interface Board {
  name: string;
  updated_at: string;
  visibility: Visibility;
  ownerId: number | null;
}

const REPO_URL = 'https://github.com/bear7066/collab-editor2';

export const Dashboard: React.FC = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newBoardName, setNewBoardName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('collab');
  const [isLoading, setIsLoading] = useState(true);
  const [createError, setCreateError] = useState('');
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    const fetchBoards = async () => {
      try {
        const response = await apiFetch('/api/boards');
        if (response.ok) setBoards(await response.json());
      } catch (error) {
        console.error('Error fetching boards:', error);
      } finally {
        setIsLoading(false);
      }
    };
    void fetchBoards();
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = newBoardName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!cleanName) return;
    setCreateError('');

    // Created through the API so the board records its owner and visibility
    // before anyone opens it.
    try {
      const response = await apiFetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, visibility }),
      });
      if (!response.ok) {
        setCreateError('Could not create that board.');
        return;
      }
      navigate(`/board/${cleanName}`);
    } catch {
      setCreateError('Could not reach the server.');
    }
  };

  const filteredBoards = boards.filter((board) => board.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const visibilityOption = (value: Visibility, label: string, icon: React.ReactNode) => (
    <button
      key={value}
      type="button"
      onClick={() => setVisibility(value)}
      aria-pressed={visibility === value}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
        visibility === value ? 'bg-surface text-ink shadow-sm' : 'text-stone hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col px-6 py-12 max-w-3xl mx-auto text-ink">
      {/* Header */}
      <header className="flex items-center justify-between mb-14">
        <h1 className="flex items-center gap-3 font-serif text-2xl font-semibold tracking-wide text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-kaki" aria-hidden="true" />
          Collab Editor
        </h1>
        <div className="flex items-center gap-4 text-sm">
          <ThemeToggle />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone hover:text-ink transition flex items-center gap-2"
            aria-label="View source on GitHub"
          >
            <Github size={18} />
            <span className="hidden sm:inline">{user.login}</span>
          </a>
          <button
            type="button"
            onClick={logout}
            className="text-stone hover:text-shu transition flex items-center gap-1.5 cursor-pointer"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* Create */}
      <form onSubmit={handleCreate} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New board name…"
            value={newBoardName}
            onChange={(event) => setNewBoardName(event.target.value)}
            className="flex-1 bg-surface border border-line-strong rounded-lg py-2.5 px-4 text-sm text-ink placeholder-stone-light focus:outline-none focus:border-ai transition"
            required
          />
          <button
            type="submit"
            className="bg-moss-deep hover:bg-moss text-on-moss rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition cursor-pointer"
          >
            <Plus size={16} />
            Create
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1 rounded-lg bg-sunken/70 p-1 w-fit select-none">
          {visibilityOption('collab', 'Collab', <Users size={13} />)}
          {visibilityOption('personal', 'Personal', <Lock size={13} />)}
        </div>
        {createError && <p className="mt-2 text-xs text-shu">{createError}</p>}
      </form>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone" />
        <input
          type="text"
          placeholder="Search boards"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full bg-transparent border border-line rounded-lg py-2 pl-10 pr-4 text-sm text-ink placeholder-stone-light focus:outline-none focus:border-ai transition"
        />
      </div>

      {/* Boards */}
      {isLoading ? (
        <div className="text-center py-8 text-stone text-sm">Loading…</div>
      ) : filteredBoards.length === 0 ? (
        <div className="text-center py-8 text-stone text-sm">{searchQuery ? 'No matches.' : 'No boards yet.'}</div>
      ) : (
        <ul className="divide-y divide-line">
          {filteredBoards.map((board) => (
            <li
              key={board.name}
              onClick={() => navigate(`/board/${board.name}`)}
              className="py-3.5 cursor-pointer transition flex items-center justify-between group"
            >
              <span className="flex items-center gap-2 min-w-0">
                {board.visibility === 'personal' && (
                  <Lock size={13} className="shrink-0 text-stone" aria-label="Personal board" />
                )}
                <span className="font-medium text-ink group-hover:text-moss-deep transition truncate">{board.name}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-stone shrink-0 ml-4">
                <Calendar size={12} />
                {new Date(board.updated_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
