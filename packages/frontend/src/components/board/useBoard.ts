import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useSyncedDoc } from '../../lib/useSyncedDoc';
import { ACCENTS, FINISH_LONG_PRESS_MS } from './constants';
import {
  createAttachmentMap,
  createGroupMap,
  createSectionMap,
  createTaskMap,
  docToBoardState,
  findSectionMap,
  findTaskMapInSection,
  getAttachmentsArray,
  getGroupsArray,
  getGroupTasks,
  getSectionNotesFragment,
  getSectionsArray,
  getTaskChildren,
} from './boardDoc';
import { deleteFile as deleteRemoteFile, uploadFile } from '../../lib/files';
import {
  collectArchive,
  countTasks,
  createId,
  currentOccurrenceDate,
  findSection,
  findTaskInSection,
  isValidDateString,
  todayDateKey,
} from './boardModel';
import type { BoardState, FlagColor, PendingFinishStatus, RecurrenceRule } from './types';

/** Click order for the flag dot. */
const FLAG_CYCLE: (FlagColor | null)[] = [null, 'red', 'yellow', 'green', 'blue', 'pink'];

export const useBoard = (boardName: string) => {
  const { doc, provider, status: syncStatus, synced } = useSyncedDoc('board', boardName);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [currentSectionId, setCurrentSectionId] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [openAdders, setOpenAdders] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingFinish, setPendingFinish] = useState<Record<string, PendingFinishStatus | undefined>>({});
  const [newGroupName, setNewGroupName] = useState('');
  const finishPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishPressCommittedRef = useRef(false);

  // The server seeds new boards with a default section; the sync provider
  // pushes local mutations and pulls remote ones into this doc.
  useEffect(() => {
    setBoard(null);
    setCurrentSectionId('');
    setCollapsedGroups(new Set());
    if (!doc) return undefined;

    // Local mutations and remote updates both funnel through this refresh path.
    const refreshBoard = () => setBoard(docToBoardState(doc));
    refreshBoard();
    doc.on('update', refreshBoard);
    return () => doc.off('update', refreshBoard);
  }, [doc]);

  const isLoading = !synced;

  useEffect(() => {
    if (!board || board.sections.length === 0) return;
    if (!currentSectionId || !findSection(board, currentSectionId)) {
      setCurrentSectionId(board.sections[0].id);
    }
  }, [board, currentSectionId]);

  const section = useMemo(
    () => (board ? findSection(board, currentSectionId) ?? board.sections[0] : undefined),
    [board, currentSectionId]
  );

  const sectionNotes = useMemo(
    () => (doc && section ? getSectionNotesFragment(doc, section.id) ?? null : null),
    [doc, section]
  );

  const archiveItems = useMemo(() => {
    if (!section) return [];
    return section.groups
      .flatMap((group) => collectArchive(group.tasks, [group.owner]))
      .sort((a, b) => new Date(b.task.completedAt ?? 0).getTime() - new Date(a.task.completedAt ?? 0).getTime());
  }, [section]);

  const sectionTaskCount = useMemo(() => {
    if (!section) return 0;
    return section.groups.reduce((total, group) => total + countTasks(group.tasks), 0);
  }, [section]);

  const visibleGroups = useMemo(() => section?.groups ?? [], [section]);

  /** Run a mutation in a single Yjs transaction; the provider syncs it to every client. */
  const updateBoard = useCallback(
    (mutate: (ydoc: Y.Doc) => void) => {
      if (!doc) return;
      doc.transact(() => {
        mutate(doc);
        doc.getMap('board').set('updatedAt', new Date().toISOString());
      });
    },
    [doc]
  );

  const finishTask = useCallback(
    (taskId: string, status: PendingFinishStatus) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;

        const recur = (found.task.get('recur') as RecurrenceRule | null) ?? null;
        if (recur) {
          // Recurring tasks never move to status/archive — completion is
          // tracked per occurrence date instead, so next week starts fresh.
          const occurrence = currentOccurrenceDate(recur, todayDateKey());
          const completions = { ...((found.task.get('recurCompletions') as Record<string, PendingFinishStatus>) ?? {}) };
          // Confirming the same status twice undoes it — the only way back to
          // "not done" for a task that never reaches the archive to restore from.
          if (completions[occurrence] === status) delete completions[occurrence];
          else completions[occurrence] = status;
          found.task.set('recurCompletions', completions);
          return;
        }

        found.task.set('status', status);
        found.task.set('completedAt', new Date().toISOString());
        if (status === 'done') found.task.set('percent', 100);
      });
    },
    [currentSectionId, updateBoard]
  );

  const clearFinishPressTimer = useCallback(() => {
    if (finishPressTimerRef.current) {
      clearTimeout(finishPressTimerRef.current);
      finishPressTimerRef.current = null;
    }
  }, []);

  const cyclePendingFinish = useCallback((taskId: string) => {
    if (finishPressCommittedRef.current) {
      finishPressCommittedRef.current = false;
      return;
    }

    setPendingFinish((prev) => {
      const current = prev[taskId];
      const next = { ...prev };
      if (!current) next[taskId] = 'done';
      else if (current === 'done') next[taskId] = 'cancelled';
      else delete next[taskId];
      return next;
    });
  }, []);

  const startFinishLongPress = useCallback(
    (taskId: string) => {
      clearFinishPressTimer();
      finishPressCommittedRef.current = false;

      const status = pendingFinish[taskId];
      if (!status) return;

      finishPressTimerRef.current = setTimeout(() => {
        finishPressCommittedRef.current = true;
        finishTask(taskId, status);
        setPendingFinish((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        finishPressTimerRef.current = null;
      }, FINISH_LONG_PRESS_MS);
    },
    [clearFinishPressTimer, finishTask, pendingFinish]
  );

  useEffect(() => () => clearFinishPressTimer(), [clearFinishPressTimer]);

  const editTaskText = useCallback(
    (taskId: string, text: string | null) => {
      const nextText = text?.trim();
      if (!nextText) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (found) found.task.set('text', nextText);
      });
    },
    [currentSectionId, updateBoard]
  );

  const editOwner = useCallback(
    (groupId: string, owner: string | null) => {
      const nextOwner = owner?.trim();
      if (!nextOwner) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const group = getGroupsArray(sectionMap).toArray().find((item) => item.get('id') === groupId);
        if (group) group.set('owner', nextOwner);
      });
    },
    [currentSectionId, updateBoard]
  );

  const editPercent = useCallback(
    (taskId: string) => {
      const current = section ? findTaskInSection(section, taskId)?.task.percent : null;
      const value = window.prompt('Progress percent, 0-100. Leave blank to clear.', current == null ? '' : String(current));
      if (value === null) return;

      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;

        if (!value.trim()) {
          found.task.set('percent', null);
          return;
        }

        const percent = Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
        found.task.set('percent', percent);
        if (percent > 0 && found.task.get('status') === 'todo') found.task.set('status', 'in_progress');
      });
    },
    [currentSectionId, section, updateBoard]
  );

  const editDate = useCallback(
    (taskId: string) => {
      const current = section ? findTaskInSection(section, taskId)?.task.date : null;
      const value = window.prompt('Date, YYYY-MM-DD. Leave blank to clear.', current ?? '');
      if (value === null) return;
      const trimmed = value.trim();

      if (trimmed && !isValidDateString(trimmed)) {
        window.alert('Please enter a real date as YYYY-MM-DD, e.g. 2026-09-20.');
        return;
      }

      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (found) found.task.set('date', trimmed || null);
      });
    },
    [currentSectionId, section, updateBoard]
  );

  const setOneOffTime = useCallback(
    (taskId: string, range: { startTime: string; endTime: string } | null) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;
        found.task.set('startTime', range?.startTime ?? null);
        found.task.set('endTime', range?.endTime ?? null);
      });
    },
    [currentSectionId, updateBoard]
  );

  const cycleFlag = useCallback(
    (taskId: string) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;
        const current = (found.task.get('flag') as FlagColor | null) ?? null;
        const next = FLAG_CYCLE[(FLAG_CYCLE.indexOf(current) + 1) % FLAG_CYCLE.length];
        found.task.set('flag', next);
      });
    },
    [currentSectionId, updateBoard]
  );

  const setRecurrence = useCallback(
    (taskId: string, nextRule: RecurrenceRule | null) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;

        if (nextRule === null) {
          found.task.set('recur', null);
          return;
        }
        // Keep the existing start date across a weekday change, so it never
        // moves backward and silently invents occurrences that never happened.
        const existing = found.task.get('recur') as RecurrenceRule | null;
        found.task.set('recur', {
          ...nextRule,
          startDate: existing?.startDate ?? todayDateKey(),
        });
      });
    },
    [currentSectionId, updateBoard]
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      if (!window.confirm('Delete this task?')) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (found) found.parent.delete(found.index, 1);
      });
    },
    [currentSectionId, updateBoard]
  );

  const restoreTask = useCallback(
    (taskId: string) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (!found) return;
        found.task.set('status', 'todo');
        found.task.set('completedAt', null);
        if (found.task.get('percent') === 100) found.task.set('percent', null);
      });
    },
    [currentSectionId, updateBoard]
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      if (!window.confirm('Delete this group and all of its tasks?')) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const groups = getGroupsArray(sectionMap);
        const index = groups.toArray().findIndex((group) => group.get('id') === groupId);
        if (index !== -1) groups.delete(index, 1);
      });
    },
    [currentSectionId, updateBoard]
  );

  const addTask = useCallback(
    (groupId: string | null, parentTaskId: string | null, text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        if (parentTaskId) {
          const found = findTaskMapInSection(sectionMap, parentTaskId);
          if (found) getTaskChildren(found.task).push([createTaskMap(cleanText)]);
          return;
        }
        const group = getGroupsArray(sectionMap).toArray().find((item) => item.get('id') === groupId);
        if (group) getGroupTasks(group).push([createTaskMap(cleanText)]);
      });
    },
    [currentSectionId, updateBoard]
  );

  const addGroup = useCallback(
    (ownerName: string) => {
      const owner = ownerName.trim();
      if (!owner) return;
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (sectionMap) getGroupsArray(sectionMap).push([createGroupMap(owner)]);
      });
      setNewGroupName('');
    },
    [currentSectionId, updateBoard]
  );

  const addSection = useCallback((name: string, mode: 'tasks' | 'notes') => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const nextId = createId('section');
    updateBoard((ydoc) => {
      const sections = getSectionsArray(ydoc);
      if (!sections) return;
      sections.push([
        createSectionMap(nextId, cleanName, ACCENTS[sections.length % ACCENTS.length], mode),
      ]);
    });
    setCurrentSectionId(nextId);
  }, [updateBoard]);

  const addAttachment = useCallback(
    async (file: File) => {
      if (!currentSectionId) throw new Error('No section selected');
      const uploaded = await uploadFile(boardName, file);
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        let attachments = getAttachmentsArray(sectionMap);
        if (!attachments) {
          attachments = new Y.Array<Y.Map<unknown>>();
          sectionMap.set('attachments', attachments);
        }
        attachments.push([createAttachmentMap(uploaded)]);
      });
      return uploaded;
    },
    [boardName, currentSectionId, updateBoard]
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      if (!currentSectionId) return;
      // Keep the visible metadata until remote deletion succeeds, so a
      // temporary network failure does not strand an inaccessible file.
      await deleteRemoteFile(attachmentId);
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        const attachments = sectionMap && getAttachmentsArray(sectionMap);
        if (!attachments) return;
        const index = attachments.toArray().findIndex((item) => item.get('id') === attachmentId);
        if (index !== -1) attachments.delete(index, 1);
      });
    },
    [currentSectionId, updateBoard]
  );

  const deleteSection = useCallback(() => {
    if (!board || !section) return;

    if (board.sections.length <= 1) {
      window.alert('At least one section must remain.');
      return;
    }

    const sectionIndex = board.sections.findIndex((item) => item.id === section.id);
    if (sectionIndex === -1) return;

    const nextSection = board.sections[sectionIndex + 1] ?? board.sections[sectionIndex - 1];
    const confirmed = window.confirm(
      `Delete section "${section.name}"?\n\n` +
        `This removes ${section.groups.length} groups, ${sectionTaskCount} tasks, and ${section.attachments?.length ?? 0} attachments.`
    );
    if (!confirmed) return;

    updateBoard((ydoc) => {
      const sections = getSectionsArray(ydoc);
      if (!sections || sections.length <= 1) return;
      const index = sections.toArray().findIndex((item) => item.get('id') === section.id);
      if (index !== -1) sections.delete(index, 1);
    });

    // The Yjs section owns attachment metadata, while the API owns the bytes.
    // Removing both prevents abandoned file rows from accumulating.
    void Promise.allSettled((section.attachments ?? []).map((attachment) => deleteRemoteFile(attachment.id)));

    if (nextSection) setCurrentSectionId(nextSection.id);
    setArchiveOpen(false);
    setCollapsedGroups(new Set());
    setOpenAdders(new Set());
  }, [board, section, sectionTaskCount, updateBoard]);

  const toggleAdder = useCallback((key: string) => {
    setOpenAdders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const closeAdder = useCallback((key: string) => {
    setOpenAdders((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const submitAdd = useCallback(
    (key: string, groupId: string | null, parentTaskId: string | null) => {
      const value = drafts[key] ?? '';
      if (!value.trim()) return;
      addTask(groupId, parentTaskId, value);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setOpenAdders((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [addTask, drafts]
  );

  return {
    addAttachment,
    addGroup,
    addSection,
    archiveItems,
    archiveOpen,
    board,
    clearFinishPressTimer,
    closeAdder,
    collapsedGroups,
    currentSectionId,
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
    removeAttachment,
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
  };
};
