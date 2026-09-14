import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MilkdownProvider } from '@milkdown/react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  FileText,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { activeChildren, countActive, currentOccurrenceDate, todayDateKey } from './board/boardModel';
import { ARCHIVE_SCROLL_THRESHOLD, FLAG_FILL_CLASS, displayAccent, formatShortDate } from './board/constants';
import { WeekSchedule } from './board/WeekSchedule';
import { RecurrencePicker } from './board/RecurrencePicker';
import { OneOffTimePicker } from './board/OneOffTimePicker';
import MeetingLogEditor from './board/MeetingLogEditor';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { ThemeToggle } from './ThemeToggle';
import { BoardVisibility } from './BoardVisibility';
import { BoardTitle } from './BoardTitle';
import { useBoardMeta } from '../lib/useBoardMeta';
import { useBoard } from './board/useBoard';
import { fileUrl } from '../lib/files';
import type { BoardTask } from './board/types';

export const Board: React.FC = () => {
  const navigate = useNavigate();
  const { boardName = '' } = useParams<{ boardName: string }>();
  const [searchParams] = useSearchParams();
  const isIframe = searchParams.get('iframe') === 'true';
  const {
    addAttachment,
    addGroup,
    addSection,
    archiveItems,
    archiveOpen,
    board,
    clearFinishPressTimer,
    closeAdder,
    collapsedGroups,
    cycleFlag,
    cyclePendingFinish,
    deleteGroup,
    deleteSection,
    deleteTask,
    drafts,
    editDate,
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
    setOneOffTime,
    setRecurrence,
    startFinishLongPress,
    submitAdd,
    syncStatus,
    toggleAdder,
    toggleGroupCollapse,
    visibleGroups,
  } = useBoard(boardName);
  const { meta, setVisibility, rename } = useBoardMeta(boardName);
  const [sectionComposerOpen, setSectionComposerOpen] = React.useState(false);
  const [sectionName, setSectionName] = React.useState('');
  const [sectionMode, setSectionMode] = React.useState<'tasks' | 'notes'>('tasks');

  const uploadEditorFile = React.useCallback(
    async (file: File) => {
      try {
        const uploaded = await addAttachment(file);
        return { url: fileUrl(uploaded.id), filename: uploaded.filename, mimeType: uploaded.mimeType };
      } catch (error) {
        throw error;
      }
    },
    [addAttachment]
  );

  // The name is the address, so a successful rename moves the page with it.
  const handleRename = async (newName: string) => {
    const result = await rename(newName);
    if (result === 'ok') navigate(`/board/${encodeURIComponent(newName)}`, { replace: true });
    return result;
  };

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
    // A recurring task never reaches status/archive; its checkbox instead
    // reflects whether the current occurrence has been confirmed done/cancelled.
    const recurStatus = task.recur ? task.recurCompletions?.[currentOccurrenceDate(task.recur, todayDateKey())] : undefined;
    const displayStatus = pendingStatus ?? recurStatus;

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
              displayStatus
                ? displayStatus === 'done'
                  ? 'border-moss bg-moss-soft text-moss-deep'
                  : 'border-shu/60 bg-shu-soft text-shu'
                : 'border-line-strong bg-surface text-stone-light hover:border-stone hover:text-ink-soft'
            }`}
            title={
              task.recur
                ? 'Click to choose V or X, then long press to confirm this week.'
                : 'Click to choose V or X, then long press to archive.'
            }
            aria-label={task.recur ? 'Click to choose done or cancelled for this occurrence.' : 'Click to choose done or cancelled, then long press to archive.'}
          >
            {displayStatus === 'done' ? (
              <Check size={14} strokeWidth={2.6} />
            ) : displayStatus === 'cancelled' ? (
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
              className="mt-0.5 rounded-full border border-ai/30 bg-ai-soft px-2 py-0.5 font-label text-[11px] text-ai transition hover:border-ai cursor-pointer"
            >
              {task.percent}%
            </button>
          )}

          {task.date && (
            <button
              type="button"
              onClick={() => editDate(task.id)}
              className="mt-0.5 rounded-full border border-line-strong px-2 py-0.5 font-label text-[11px] text-stone transition hover:border-stone hover:text-ink cursor-pointer"
              title="Change date"
            >
              {formatShortDate(task.date)}
            </button>
          )}

          <button
            type="button"
            onClick={() => cycleFlag(task.id)}
            className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border transition cursor-pointer ${
              task.flag ? `${FLAG_FILL_CLASS[task.flag]} border-transparent` : 'border-line-strong hover:border-stone'
            }`}
            title={task.flag ? `Calendar tag: ${task.flag}. Click to change.` : 'Add a calendar tag (red/yellow/green/blue/pink)'}
            aria-label={task.flag ? `Calendar tag: ${task.flag}` : 'Add a calendar tag'}
          />

          {!task.recur && (
            <OneOffTimePicker
              startTime={task.startTime}
              endTime={task.endTime}
              onChange={(range) => setOneOffTime(task.id, range)}
            />
          )}

          <RecurrencePicker recur={task.recur ?? null} onChange={(rule) => setRecurrence(task.id, rule)} />

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
              onClick={() => editDate(task.id)}
              className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ai cursor-pointer"
              title="Set date"
              aria-label="Set date"
            >
              <CalendarDays size={14} />
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
      <div className="flex min-h-screen items-center justify-center px-5 text-ink-soft">
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
      <div className="flex min-h-screen items-center justify-center text-stone">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 size={18} className="animate-spin text-moss" />
          {syncStatus === 'offline' ? 'Reconnecting to board…' : 'Loading board...'}
        </div>
      </div>
    );
  }

  if (!board || !section) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 text-ink-soft">
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
    <div className="min-h-screen flex flex-col relative text-ink">
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
              <BoardTitle boardName={boardName} canRename={meta?.isOwner ?? false} onRename={handleRename} />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {meta && <BoardVisibility visibility={meta.visibility} isOwner={meta.isOwner} onToggle={setVisibility} />}
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

      <div className={`${isIframe ? 'w-full px-5 py-5' : `mx-auto w-full px-5 py-7 ${meta?.visibility === 'personal' ? 'max-w-[1500px]' : 'max-w-6xl'}`}`}>

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
                {item.mode === 'notes' ? (
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-label text-[11px] ${
                      isActive ? 'bg-moss-soft text-moss-deep' : 'bg-sunken text-stone'
                    }`}
                  >
                    <FileText size={11} />
                    Note
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 font-label text-[11px] ${
                      isActive ? 'bg-moss-soft text-moss-deep' : 'bg-sunken text-stone'
                    }`}
                  >
                    {activeCount}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSectionComposerOpen(true)}
            className="px-3 py-2.5 font-label text-xs text-stone transition hover:text-moss-deep cursor-pointer"
          >
            + Section
          </button>
        </nav>

        {section.mode === 'notes' && (
          <section className="mb-5 rounded-xl border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">Notes</h2>
              <button
                type="button"
                onClick={deleteSection}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-stone transition hover:bg-shu/10 hover:text-shu"
                aria-label={`Delete section ${section.name}`}
              >
                <Trash2 size={13} />
                Delete section
              </button>
            </div>
            {sectionNotes && provider && (
              <MilkdownProvider>
                <MeetingLogEditor
                  key={section.id}
                  fragment={sectionNotes}
                  provider={provider}
                  onUploadFile={uploadEditorFile}
                  tall
                />
              </MilkdownProvider>
            )}
          </section>
        )}

        {section.mode !== 'notes' && (
          <main
            className={`grid items-start gap-5 ${
              meta?.visibility === 'personal' ? 'lg:grid-cols-2' : 'lg:grid-cols-[minmax(0,1fr)_320px]'
            }`}
          >
          {meta?.visibility === 'personal' && (
            <aside className="min-w-0 lg:sticky lg:top-24">
              <WeekSchedule key={boardName} sections={board.sections} />
            </aside>
          )}

          <section className="min-w-0">

            {visibleGroups.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 font-label text-sm text-stone">
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
                        className="rounded-md bg-moss-soft px-2.5 py-1 font-label text-xs font-bold tracking-wide text-moss-deep outline-none focus:ring-2 focus:ring-moss/40"
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
                          <div className="py-2 font-label text-xs text-stone">No active tasks.</div>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleAdder(key)}
                          className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 font-label text-xs text-stone transition hover:text-moss-deep cursor-pointer"
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

          <aside className={`space-y-3 ${meta?.visibility === 'personal' ? 'lg:col-start-2' : ''}`}>
            <section className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
                  Meeting Log
                </h2>
                <button
                  type="button"
                  onClick={deleteSection}
                  className="cursor-pointer rounded-md p-1.5 text-stone transition hover:bg-shu/10 hover:text-shu"
                  title="Delete section"
                  aria-label={`Delete section ${section.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {sectionNotes && provider && (
                <MilkdownProvider>
                  <MeetingLogEditor
                    key={section.id}
                    fragment={sectionNotes}
                    provider={provider}
                    onUploadFile={uploadEditorFile}
                  />
                </MilkdownProvider>
              )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="mb-3 font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
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
                <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">
                  Done / Cancelled
                </span>
                <span className="ml-auto font-label text-xs text-moss-deep">{archiveItems.length}</span>
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
                    <div className="font-label text-xs text-stone">Archive is empty.</div>
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
                            <div className="truncate font-label text-[10px] text-stone-light">
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
          </aside>
          </main>
        )}

        {sectionComposerOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 px-5 backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSectionComposerOpen(false);
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-section-title"
              className="w-full max-w-md rounded-2xl border border-line bg-paper p-5 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault();
                if (!sectionName.trim()) return;
                addSection(sectionName, sectionMode);
                setSectionComposerOpen(false);
                setSectionName('');
                setSectionMode('tasks');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSectionComposerOpen(false);
              }}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 id="new-section-title" className="font-serif text-lg font-semibold text-ink">New section</h2>
                  <p className="mt-1 text-xs leading-5 text-stone">Choose what this section is for.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSectionComposerOpen(false)}
                  className="rounded-md p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer"
                  aria-label="Close new section dialog"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSectionMode('tasks')}
                  aria-pressed={sectionMode === 'tasks'}
                  className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                    sectionMode === 'tasks' ? 'border-moss bg-moss-soft' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <ListTodo size={17} className="mb-2 text-moss-deep" />
                  <span className="block text-sm font-semibold text-ink">Tasks</span>
                  <span className="mt-1 block text-xs leading-4 text-stone">Meeting log and task groups</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSectionMode('notes')}
                  aria-pressed={sectionMode === 'notes'}
                  className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                    sectionMode === 'notes' ? 'border-ai bg-ai-soft' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <FileText size={17} className="mb-2 text-ai" />
                  <span className="block text-sm font-semibold text-ink">Note</span>
                  <span className="mt-1 block text-xs leading-4 text-stone">Focused notes and file storage</span>
                </button>
              </div>

              <label className="mb-1.5 block font-label text-[11px] font-semibold uppercase tracking-[0.1em] text-stone" htmlFor="new-section-name">
                Section name
              </label>
              <input
                id="new-section-name"
                autoFocus
                value={sectionName}
                onChange={(event) => setSectionName(event.target.value)}
                placeholder={sectionMode === 'notes' ? 'Research notes' : 'Next sprint'}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-stone-light focus:border-ai"
              />

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSectionComposerOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-stone transition hover:text-ink cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!sectionName.trim()}
                  className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white transition hover:bg-moss-deep disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  Create {sectionMode === 'notes' ? 'note' : 'section'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default Board;
