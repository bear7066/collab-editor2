import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ACCENTS, FINISH_LONG_PRESS_MS } from './constants';
import {
  BOARD_ROOM_PREFIX,
  createGroupMap,
  createSectionMap,
  createTaskMap,
  docToBoardState,
  findSectionMap,
  findTaskMapInSection,
  getGroupsArray,
  getGroupTasks,
  getSectionNotesFragment,
  getSectionsArray,
  getTaskChildren,
} from './boardDoc';
import { randomPresenceUser } from '../../lib/presence';
import {
  collectArchive,
  countTasks,
  createId,
  findSection,
  findTaskInSection,
  normalizeLink,
} from './boardModel';
import type { BoardState, PendingFinishStatus } from './types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const useBoard = (boardName: string) => {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [onlineCount, setOnlineCount] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [currentSectionId, setCurrentSectionId] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [openAdders, setOpenAdders] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingFinish, setPendingFinish] = useState<Record<string, PendingFinishStatus | undefined>>({});
  const [newGroupName, setNewGroupName] = useState('');
  const finishPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishPressCommittedRef = useRef(false);

  // Connect to the board's Yjs room. The server seeds new boards with a default
  // section and persists the doc, so there is no REST load/save cycle here.
  useEffect(() => {
    if (!boardName) return undefined;

    const ydoc = new Y.Doc();
    const wsHost = import.meta.env.DEV
      ? 'ws://localhost:3001'
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const wsProvider = new WebsocketProvider(wsHost, `${BOARD_ROOM_PREFIX}${boardName}`, ydoc);
    // Identity shown on remote meeting-log cursors and in the online-users badge.
    wsProvider.awareness.setLocalStateField('user', randomPresenceUser());

    setDoc(ydoc);
    setProvider(wsProvider);
    setBoard(null);
    setIsLoading(true);
    setCurrentSectionId('');
    setCollapsedGroups(new Set());

    // Local mutations and remote updates both funnel through this refresh path.
    const refreshBoard = () => setBoard(docToBoardState(ydoc));
    ydoc.on('update', refreshBoard);

    const handleStatus = (event: { status: ConnectionStatus }) => setConnectionStatus(event.status);
    wsProvider.on('status', handleStatus);

    const handleSync = (isSynced: boolean) => {
      if (!isSynced) return;
      refreshBoard();
      setIsLoading(false);
    };
    wsProvider.on('sync', handleSync);

    const handleAwarenessChange = () => setOnlineCount(wsProvider.awareness.getStates().size);
    wsProvider.awareness.on('change', handleAwarenessChange);

    return () => {
      wsProvider.awareness.off('change', handleAwarenessChange);
      wsProvider.destroy();
      ydoc.off('update', refreshBoard);
      ydoc.destroy();
      setProvider(null);
      setDoc(null);
    };
  }, [boardName]);

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

  const toggleStar = useCallback(
    (taskId: string) => {
      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (found) found.task.set('starred', !found.task.get('starred'));
      });
    },
    [currentSectionId, updateBoard]
  );

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

  const editLink = useCallback(
    (taskId: string) => {
      const current = section ? findTaskInSection(section, taskId)?.task.link : null;
      const value = window.prompt('Task link. Leave blank to remove.', current ?? '');
      if (value === null) return;

      updateBoard((ydoc) => {
        const sectionMap = findSectionMap(ydoc, currentSectionId);
        if (!sectionMap) return;
        const found = findTaskMapInSection(sectionMap, taskId);
        if (found) found.task.set('link', normalizeLink(value));
      });
    },
    [currentSectionId, section, updateBoard]
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

  const addSection = useCallback(() => {
    const name = window.prompt('New section name:');
    if (!name?.trim()) return;
    const cleanName = name.trim();
    const nextId = createId('section');
    updateBoard((ydoc) => {
      const sections = getSectionsArray(ydoc);
      if (!sections) return;
      sections.push([createSectionMap(nextId, cleanName, ACCENTS[sections.length % ACCENTS.length])]);
    });
    setCurrentSectionId(nextId);
  }, [updateBoard]);

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
        `This removes ${section.groups.length} groups and ${sectionTaskCount} tasks, including archived tasks.`
    );
    if (!confirmed) return;

    updateBoard((ydoc) => {
      const sections = getSectionsArray(ydoc);
      if (!sections || sections.length <= 1) return;
      const index = sections.toArray().findIndex((item) => item.get('id') === section.id);
      if (index !== -1) sections.delete(index, 1);
    });

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
    addGroup,
    addSection,
    archiveItems,
    archiveOpen,
    board,
    clearFinishPressTimer,
    closeAdder,
    collapsedGroups,
    connectionStatus,
    currentSectionId,
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
    onlineCount,
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
    toggleAdder,
    toggleGroupCollapse,
    toggleStar,
    visibleGroups,
  };
};
