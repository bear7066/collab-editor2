import * as Y from 'yjs';

/**
 * Boards sync through Yjs rooms named `board/<boardName>` so they never
 * collide with project rooms (project names cannot contain a slash).
 */
export const BOARD_ROOM_PREFIX = 'board/';

export const isBoardRoom = (docName: string) => docName.startsWith(BOARD_ROOM_PREFIX);

export const boardNameFromRoom = (docName: string) => docName.slice(BOARD_ROOM_PREFIX.length);

export interface BoardTask {
  id: string;
  text: string;
  status: string;
  starred: boolean;
  percent: number | null;
  link: string | null;
  completedAt: string | null;
  children: BoardTask[];
}

export interface BoardGroup {
  id: string;
  owner: string;
  tasks: BoardTask[];
}

export interface BoardSection {
  id: string;
  name: string;
  accent: string;
  /**
   * Meeting-log notes. In the live doc this is a Y.XmlFragment edited by the
   * clients' ProseMirror editors; the derived JSON snapshot serializes it as
   * an XML string, which is informational only and never applied back.
   */
  notes: string;
  groups: BoardGroup[];
}

export interface BoardState {
  meta: {
    meetLink: string;
    meetSchedule: string;
  };
  sections: BoardSection[];
  updatedAt: string;
}

export function createDefaultBoardState(): BoardState {
  return {
    meta: {
      meetLink: '',
      meetSchedule: '',
    },
    sections: [
      {
        id: 'section_general',
        name: 'General',
        accent: '#6b8f71',
        notes: '',
        groups: [],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function parseBoardState(value: string | null | undefined): BoardState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BoardState>;
    if (!parsed || !Array.isArray(parsed.sections) || !parsed.meta) return null;
    return parsed as BoardState;
  } catch {
    return null;
  }
}

function taskToYMap(task: BoardTask): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', task.id);
  map.set('text', task.text);
  map.set('status', task.status);
  map.set('starred', task.starred);
  map.set('percent', task.percent);
  map.set('link', task.link);
  map.set('completedAt', task.completedAt);
  const children = new Y.Array<Y.Map<unknown>>();
  children.push(task.children.map(taskToYMap));
  map.set('children', children);
  return map;
}

function groupToYMap(group: BoardGroup): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', group.id);
  map.set('owner', group.owner);
  const tasks = new Y.Array<Y.Map<unknown>>();
  tasks.push(group.tasks.map(taskToYMap));
  map.set('tasks', tasks);
  return map;
}

function sectionToYMap(section: BoardSection): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', section.id);
  map.set('name', section.name);
  map.set('accent', section.accent);
  // Notes are a ProseMirror-bound Y.XmlFragment (see frontend boardDoc.ts).
  // The server cannot parse markdown into ProseMirror nodes, so seeding always
  // starts the fragment empty; content only ever comes from clients.
  map.set('notes', new Y.XmlFragment());
  const groups = new Y.Array<Y.Map<unknown>>();
  groups.push(section.groups.map(groupToYMap));
  map.set('groups', groups);
  return map;
}

/** Populate an empty board doc from a plain JSON board state. */
export function applyBoardStateToDoc(doc: Y.Doc, state: BoardState) {
  const root = doc.getMap('board');
  doc.transact(() => {
    const meta = new Y.Map<unknown>();
    meta.set('meetLink', state.meta.meetLink ?? '');
    meta.set('meetSchedule', state.meta.meetSchedule ?? '');
    root.set('meta', meta);
    const sections = new Y.Array<Y.Map<unknown>>();
    sections.push(state.sections.map(sectionToYMap));
    root.set('sections', sections);
    root.set('updatedAt', state.updatedAt ?? new Date().toISOString());
  });
}

/** Snapshot the doc's shared types back to a plain JSON board state. */
export function boardStateFromDoc(doc: Y.Doc): BoardState {
  return doc.getMap('board').toJSON() as BoardState;
}
