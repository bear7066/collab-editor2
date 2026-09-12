import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Calendar, Github, FileText, KanbanSquare, LogOut } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from './auth/AuthGate';

interface Project {
  name: string;
  markdown: string;
  updated_at: string;
}

interface Board {
  name: string;
  updated_at: string;
}

type DashboardTab = 'projects' | 'boards';

const REPO_URL = 'https://github.com/bear7066/collab-editor2';

export const Dashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: DashboardTab = searchParams.get('tab') === 'boards' ? 'boards' : 'projects';

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [projectsRes, boardsRes] = await Promise.all([apiFetch('/api/projects'), apiFetch('/api/boards')]);
      if (projectsRes.ok) setProjects(await projectsRes.json());
      if (boardsRes.ok) setBoards(await boardsRes.json());
    } catch (err) {
      console.error('Error fetching projects and boards:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newItemName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!cleanName) return;
    navigate(activeTab === 'projects' ? `/project/${cleanName}` : `/board/${cleanName}`);
  };

  const label = activeTab === 'projects' ? 'project' : 'board';
  const items: { name: string; updated_at: string }[] = activeTab === 'projects' ? projects : boards;
  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="min-h-screen flex flex-col px-6 py-12 max-w-3xl mx-auto text-ink">
      {/* Header */}
      <header className="flex items-center justify-between mb-14">
        <h1 className="flex items-center gap-3 font-serif text-2xl font-semibold tracking-wide text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-kaki" aria-hidden="true" />
          CollabEditor
        </h1>
        <div className="flex items-center gap-4 text-sm">
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

      {/* Tabs */}
      <nav className="flex items-end gap-1 border-b border-line mb-8">
        {(
          [
            { tab: 'projects' as const, name: 'Projects', icon: <FileText size={15} /> },
            { tab: 'boards' as const, name: 'Boards', icon: <KanbanSquare size={15} /> },
          ]
        ).map(({ tab, name, icon }) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSearchParams({ tab })}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer ${
              activeTab === tab
                ? 'border-moss text-ink'
                : 'border-transparent text-stone hover:text-ink'
            }`}
          >
            {icon}
            {name}
          </button>
        ))}
      </nav>

      {/* Create */}
      <form onSubmit={handleCreate} className="flex gap-2 mb-8">
        <input
          type="text"
          placeholder={`New ${label} name…`}
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          className="flex-1 bg-surface border border-line-strong rounded-lg py-2.5 px-4 text-sm text-ink placeholder-stone-light focus:outline-none focus:border-ai transition"
          required
        />
        <button
          type="submit"
          className="bg-moss-deep hover:bg-moss text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition cursor-pointer"
        >
          <Plus size={16} />
          Create
        </button>
      </form>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone" />
        <input
          type="text"
          placeholder={`Search ${label}s`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent border border-line rounded-lg py-2 pl-10 pr-4 text-sm text-ink placeholder-stone-light focus:outline-none focus:border-ai transition"
        />
      </div>

      {/* Projects / Boards */}
      {isLoading ? (
        <div className="text-center py-8 text-stone text-sm">Loading…</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-8 text-stone text-sm">
          {searchQuery ? 'No matches.' : `No ${label}s yet.`}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {filteredItems.map((item) => (
            <li
              key={item.name}
              onClick={() => navigate(`/${label}/${item.name}`)}
              className="py-3.5 cursor-pointer transition flex items-center justify-between group"
            >
              <span className="font-medium text-ink group-hover:text-moss-deep transition truncate">
                {item.name}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-stone shrink-0 ml-4">
                <Calendar size={12} />
                {new Date(item.updated_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
