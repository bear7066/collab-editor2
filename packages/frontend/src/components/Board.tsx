import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MilkdownProvider } from '@milkdown/react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  Circle,
  Link as LinkIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { activeChildren, countActive } from './board/boardModel';
import { ARCHIVE_SCROLL_THRESHOLD, displayAccent } from './board/constants';
import MeetingLogEditor from './board/MeetingLogEditor';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { ThemeToggle } from './ThemeToggle';
import { BoardVisibility } from './BoardVisibility';
import { useBoard } from './board/useBoard';
import type { BoardTask } from './board/types';

export const Board: React.FC = () => {
  const navigate = useNavigate();
  const { boardName = '' } = useParams<{ boardName: string }>();
  const [searchParams] = useSearchParams();
  const isIframe = searchParams.get('iframe') === 'true';
  const {
    addGroup,
    addSection,
    archiveItems,
    archiveOpen,
    board,
    clearFinishPressTimer,
    closeAdder,
    collapsedGroups,
    cyclePendingFinish,
    deleteGroup,
    deleteSection,
    deleteTask,
    drafts,
    editLink,
    editOwner,
    editPercent,
    editTaskText,
    isLoading,
    newGroupName,
    openAdders,
    pendingFinish,
    provider,
    restoreTask,
    section,
    sectionNotes,
    setArchiveOpen,
    setCurrentSectionId,
    setDrafts,
    setNewGroupName,
    startFinishLongPress,
    submitAdd,
    syncStatus,
    toggleAdder,
    toggleGroupCollapse,
    toggleStar,
    visibleGroups,
  } = useBoard(boardName);

  const renderAddRow = (key: string, groupId: string | null, parentTaskId: string | null, nested = false) => (
    <form
      className={`mt-2 flex gap-2 ${nested ? 'ml-9' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        submitAdd(key, groupId, parentTaskId);
      }}
    >
      <input
        autoFocus
        value={drafts[key] ?? ''}
        onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeAdder(key);
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none transition placeholder:text-stone-light focus:border-ai"
        placeholder={nested ? 'Subtask title' : 'Task title'}
      />
      <button
        type="submit"
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-moss hover:text-moss-deep cursor-pointer"
      >
        Add
      </button>
    </form>
  );

  const renderTaskNode = (task: BoardTask, depth = 0): React.ReactNode => {
    const key = `task_${task.id}`;
    const children = activeChildren(task.children);
    const pendingStatus = pendingFinish[task.id];

    return (
      <div key={task.id} className={depth > 0 ? 'mt-1' : 'mt-1.5'}>
        <div
          className={`flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-sunken/70 ${
            task.status === 'cancelled' ? 'text-stone line-through' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => cyclePendingFinish(task.id)}
            onPointerDown={() => startFinishLongPress(task.id)}
            onPointerUp={clearFinishPressTimer}
            onPointerLeave={clearFinishPressTimer}
            onPointerCancel={clearFinishPressTimer}
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition cursor-pointer ${
              pendingStatus
                ? pendingStatus === 'done'
                  ? 'border-moss bg-moss-soft text-moss-deep'
                  : 'border-shu/60 bg-shu-soft text-shu'
                : 'border-line-strong bg-surface text-stone-light hover:border-stone hover:text-ink-soft'
            }`}
            title="Click to choose V or X, then long press to archive."
            aria-label="Click to choose done or cancelled, then long press to archive."
          >
            {pendingStatus === 'done' ? (
              <Check size={14} strokeWidth={2.6} />
            ) : pendingStatus === 'cancelled' ? (
              <X size={14} strokeWidth={2.6} />
            ) : (
              <Circle size={10} />
            )}
          </button>

          <span
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={(event) => editTaskText(task.id, event.currentTarget.textContent)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 rounded px-1 text-sm leading-6 text-ink outline-none focus:bg-surface focus:ring-2 focus:ring-ai/40"
          >
            {task.text}
          </span>

          {task.percent != null && (
            <button
              type="button"
              onClick={() => editPercent(task.id)}
              className="mt-0.5 rounded-full border border-ai/30 bg-ai-soft px-2 py-0.5 font-mono text-[11px] text-ai transition hover:border-ai cursor-pointer"
            >
              {task.percent}%
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleStar(task.id)}
            className={`mt-0.5 rounded p-1 transition cursor-pointer ${
              task.starred ? 'text-kaki' : 'text-stone-light hover:text-kaki'
            }`}
            title="Toggle priority"
            aria-label="Toggle priority"
          >
            <Star size={14} fill={task.starred ? 'currentColor' : 'none'} />
          </button>

          {task.link && (
            <a
              href={task.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 rounded p-1 text-stone transition hover:text-ai"
              title={task.link}
              aria-label="Open task link"
            >
              <LinkIcon size={14} />
            </a>
          )}

          <div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-70 transition hover:opacity-100">
            <button
              type="button"
              onClick={() => editPercent(task.id)}
              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ai cursor-pointer"
              title="Set progress"
              aria-label="Set progress"
            >
              <BarChart3 size={14} />
            </button>
            <button
              type="button"
              onClick={() => editLink(task.id)}
              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ai cursor-pointer"
              title="Edit link"
              aria-label="Edit link"
            >
              <LinkIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => toggleAdder(key)}
              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-moss-deep cursor-pointer"
              title="Add subtask"
              aria-label="Add subtask"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={() => deleteTask(task.id)}
              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-shu cursor-pointer"
              title="Delete task"
              aria-label="Delete task"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {openAdders.has(key) && renderAddRow(key, null, task.id, true)}

        {children.length > 0 && (
          <div className="ml-8 border-l border-dashed border-line-strong pl-3">
            {children.map((child) => renderTaskNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // A 404 means the board does not exist or belongs to someone else; the
  // provider stops retrying, so show the dead end instead of "reconnecting".
  if (syncStatus === 'notFound') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-5 text-ink-soft">
        <div className="max-w-md rounded-xl border border-line bg-surface p-5">
          <h1 className="mb-2 font-serif text-lg font-semibold text-ink">Board unavailable</h1>
          <p className="mb-4 text-sm leading-6 text-stone">
            This board does not exist, or it is personal to someone else.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md border border-line-strong px-3 py-2 text-sm font-semibold text-ink-soft transition hover:border-stone hover:text-ink cursor-pointer"
          >
            Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-stone">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 size={18} className="animate-spin text-moss" />
          {syncStatus === 'offline' ? 'Reconnecting to board…' : 'Loading board...'}
        </div>
      </div>
    );
  }

  if (!board || !section) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-5 text-ink-soft">
        <div className="max-w-md rounded-xl border border-line bg-surface p-5">
          <h1 className="mb-2 font-serif text-lg font-semibold text-ink">Board unavailable</h1>
          <p className="mb-4 text-sm leading-6 text-stone">
            The board could not be loaded from the server.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md border border-line-strong px-3 py-2 text-sm font-semibold text-ink-soft transition hover:border-stone hover:text-ink cursor-pointer"
          >
            Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative text-ink bg-paper">
      {!isIframe && (
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-b border-line bg-paper/85 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="shrink-0 p-2 bg-surface border border-line hover:border-moss/60 hover:bg-sunken/60 rounded-xl text-stone hover:text-ink transition cursor-pointer"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-moss-deep bg-moss-soft px-2 py-0.5 rounded-md">
                  Board
                </span>
                <SyncStatusIndicator status={syncStatus} />
              </div>
              <h1 className="font-serif text-lg font-semibold text-ink truncate">/board/{boardName}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <BoardVisibility boardName={boardName} />
            <ThemeToggle variant="pill" />
            {board.meta.meetLink && (
              <a
                className="flex items-center gap-2 bg-surface border border-line rounded-xl py-1.5 px-3 text-xs font-medium text-stone transition hover:border-ai/50 hover:text-ai"
                href={board.meta.meetLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Video size={13} />
                <span className="text-ink-soft">Meet</span>
                {board.meta.meetSchedule && <span className="text-stone">{board.meta.meetSchedule}</span>}
              </a>
            )}
          </div>
        </header>
      )}

      <div className={`${isIframe ? 'w-full px-5 py-5' : 'mx-auto w-full max-w-6xl px-5 py-7'}`}>

        <nav className="mb-5 flex flex-wrap items-end gap-1 border-b border-line">
          {board.sections.map((item) => {
            const isActive = item.id === section.id;
            const activeCount = item.groups.reduce((total, group) => total + countActive(group.tasks), 0);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentSectionId(item.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition cursor-pointer ${
                  isActive ? 'text-ink' : 'border-transparent text-stone hover:text-ink'
                }`}
                style={isActive ? { borderColor: displayAccent(item.accent) } : undefined}
              >
                {item.name}
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                    isActive ? 'bg-moss-soft text-moss-deep' : 'bg-sunken text-stone'
                  }`}
                >
                  {activeCount}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={addSection}
            className="px-3 py-2.5 font-mono text-xs text-stone transition hover:text-moss-deep cursor-pointer"
          >
            + Section
          </button>
        </nav>

        <main className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            <section className="mb-3 rounded-xl border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
                  Meeting Log
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-light">Markdown</span>
              </div>
              {sectionNotes && provider && (
                <MilkdownProvider>
                  <MeetingLogEditor key={section.id} fragment={sectionNotes} provider={provider} />
                </MilkdownProvider>
              )}
            </section>

            {visibleGroups.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 font-mono text-sm text-stone">
                No groups yet.
              </div>
            ) : (
              visibleGroups.map((group) => {
                const key = `group_${group.id}`;
                const tasks = activeChildren(group.tasks);
                const isCollapsed = collapsedGroups.has(group.id);

                return (
                  <article
                    key={group.id}
                    className="mb-3 rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(group.id)}
                        className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer"
                        title={isCollapsed ? 'Expand group' : 'Collapse group'}
                        aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                      >
                        <ChevronRight size={15} className={`transition ${isCollapsed ? '' : 'rotate-90'}`} />
                      </button>
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        onBlur={(event) => editOwner(group.id, event.currentTarget.textContent)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        className="rounded-md bg-moss-soft px-2.5 py-1 font-mono text-xs font-bold tracking-wide text-moss-deep outline-none focus:ring-2 focus:ring-moss/40"
                      >
                        {group.owner}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteGroup(group.id)}
                        className="ml-auto rounded-md px-2 py-1 text-xs text-stone transition hover:bg-shu-soft hover:text-shu cursor-pointer"
                      >
                        Delete group
                      </button>
                    </div>

                    {!isCollapsed && (
                      <>
                        {tasks.length > 0 ? (
                          <div>{tasks.map((task) => renderTaskNode(task))}</div>
                        ) : (
                          <div className="py-2 font-mono text-xs text-stone">No active tasks.</div>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleAdder(key)}
                          className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-xs text-stone transition hover:text-moss-deep cursor-pointer"
                        >
                          <Plus size={13} />
                          Add task
                        </button>
                        {openAdders.has(key) && renderAddRow(key, group.id, null)}
                      </>
                    )}
                  </article>
                );
              })
            )}
          </section>

          <aside className="space-y-3">
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
                Groups
              </h2>
              <p className="mb-3 text-xs leading-5 text-stone">
                Use the chevron beside each group name to collapse or expand its tasks.
              </p>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addGroup(newGroupName);
                }}
              >
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none transition placeholder:text-stone-light focus:border-ai"
                  placeholder="New owner / group"
                />
                <button
                  type="submit"
                  className="rounded-md border border-line-strong bg-paper px-3 py-2 text-xs font-semibold text-ink-soft transition hover:border-moss hover:text-moss-deep cursor-pointer"
                >
                  Add
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-line bg-surface p-4">
              <button
                type="button"
                onClick={() => setArchiveOpen((value) => !value)}
                className="flex w-full items-center gap-2 text-left cursor-pointer"
              >
                <Archive size={14} className="text-stone" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
                  Done / Cancelled
                </span>
                <span className="ml-auto font-mono text-xs text-moss-deep">{archiveItems.length}</span>
                <ChevronRight size={15} className={`text-stone transition ${archiveOpen ? 'rotate-90' : ''}`} />
              </button>
              <p className="mt-2 text-xs leading-5 text-stone">
                On a task, click V or X, then long-press that button to move it here.
              </p>

              {archiveOpen && (
                <div
                  className={`mt-3 space-y-4 ${
                    archiveItems.length > ARCHIVE_SCROLL_THRESHOLD ? 'max-h-[30rem] overflow-y-auto pr-2' : ''
                  }`}
                >
                  {archiveItems.length === 0 ? (
                    <div className="font-mono text-xs text-stone">Archive is empty.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {archiveItems.map((entry) => (
                        <div key={entry.task.id} className="flex items-start gap-2 text-xs">
                          <span
                            className={`mt-0.5 ${
                              entry.task.status === 'done' ? 'text-moss-deep' : 'text-shu'
                            }`}
                          >
                            {entry.task.status === 'done' ? <Check size={13} /> : <X size={13} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[10px] text-stone-light">
                              {entry.crumb.join(' > ')}
                            </div>
                            <div
                              className={`text-ink-soft ${
                                entry.task.status === 'cancelled' ? 'line-through' : ''
                              }`}
                            >
                              {entry.task.text}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => restoreTask(entry.task.id)}
                              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-moss-deep cursor-pointer"
                              title="Restore to group"
                              aria-label="Restore to group"
                            >
                              <ChevronRight size={13} className="-rotate-90" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTask(entry.task.id)}
                              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-shu cursor-pointer"
                              title="Delete archived task"
                              aria-label="Delete archived task"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-shu/25 bg-shu-soft/40 p-4">
              <h2 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-shu">
                Danger Zone
              </h2>
              <p className="mb-3 text-xs leading-5 text-stone">
                Delete the current section after confirming the browser prompt. This removes its groups, tasks, notes,
                and archive.
              </p>
              <button
                type="button"
                onClick={deleteSection}
                disabled={board.sections.length <= 1}
                className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                  board.sections.length <= 1
                    ? 'cursor-not-allowed border-line bg-sunken/60 text-stone-light'
                    : 'cursor-pointer border-shu/40 bg-surface text-shu hover:border-shu hover:bg-shu-soft'
                }`}
              >
                <Trash2 size={14} />
                Delete "{section.name}" section
              </button>
              {board.sections.length <= 1 && (
                <div className="mt-2 font-mono text-[11px] text-stone">At least one section must remain.</div>
              )}
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
};

export default Board;
