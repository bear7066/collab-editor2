import * as Y from 'yjs';
import { createId } from './boardModel';
import type { BoardState } from './types';

/**
 * Boards sync through Yjs rooms named `board/<boardName>` so they never
 * collide with project rooms (project names cannot contain a slash).
 *
 * Doc schema (mirrored by the backend's board-doc.ts): a root Y.Map named
 * "board" with `meta` (Y.Map), `sections` (Y.Array of Y.Maps holding `groups`
 * of nested `tasks`), and `updatedAt`. Section `notes` are a Y.XmlFragment
 * bound to the meeting-log ProseMirror editor, so concurrent edits merge and
 * remote cursors can anchor to shared positions.
 */
export const BOARD_ROOM_PREFIX = 'board/';

export type YBoardMap = Y.Map<unknown>;
export type YTaskArray = Y.Array<YBoardMap>;

export interface YTaskLocation {
  task: YBoardMap;
  parent: YTaskArray;
  index: number;
}

/** Snapshot the doc's shared types to a plain board state, or null before the server seeds it. */
export const docToBoardState = (doc: Y.Doc): BoardState | null => {
  const root = doc.getMap('board');
  if (!root.has('meta') || !root.has('sections')) return null;
  return root.toJSON() as BoardState;
};

export const getSectionsArray = (doc: Y.Doc) =>
  doc.getMap('board').get('sections') as Y.Array<YBoardMap> | undefined;

export const findSectionMap = (doc: Y.Doc, sectionId: string) =>
  getSectionsArray(doc)?.toArray().find((section) => section.get('id') === sectionId);

export const getGroupsArray = (section: YBoardMap) => section.get('groups') as Y.Array<YBoardMap>;

export const getGroupTasks = (group: YBoardMap) => group.get('tasks') as YTaskArray;

export const getTaskChildren = (task: YBoardMap) => task.get('children') as YTaskArray;

export const getSectionNotesFragment = (doc: Y.Doc, sectionId: string) =>
  findSectionMap(doc, sectionId)?.get('notes') as Y.XmlFragment | undefined;

export const findTaskMapDeep = (tasks: YTaskArray, taskId: string): YTaskLocation | null => {
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks.get(index);
    if (task.get('id') === taskId) return { task, parent: tasks, index };
    const found = findTaskMapDeep(getTaskChildren(task), taskId);
    if (found) return found;
  }
  return null;
};

export const findTaskMapInSection = (section: YBoardMap, taskId: string): YTaskLocation | null => {
  for (const group of getGroupsArray(section).toArray()) {
    const found = findTaskMapDeep(getGroupTasks(group), taskId);
    if (found) return found;
  }
  return null;
};

export const createTaskMap = (text: string): YBoardMap => {
  const task = new Y.Map<unknown>();
  task.set('id', createId('task'));
  task.set('text', text);
  task.set('status', 'todo');
  task.set('starred', false);
  task.set('percent', null);
  task.set('link', null);
  task.set('completedAt', null);
  task.set('date', null);
  task.set('startTime', null);
  task.set('endTime', null);
  task.set('flag', null);
  task.set('recur', null);
  task.set('recurCompletions', {});
  task.set('children', new Y.Array<YBoardMap>());
  return task;
};

export const createGroupMap = (owner: string): YBoardMap => {
  const group = new Y.Map<unknown>();
  group.set('id', createId('group'));
  group.set('owner', owner);
  group.set('tasks', new Y.Array<YBoardMap>());
  return group;
};

export const createSectionMap = (id: string, name: string, accent: string): YBoardMap => {
  const section = new Y.Map<unknown>();
  section.set('id', id);
  section.set('name', name);
  section.set('accent', accent);
  section.set('notes', new Y.XmlFragment());
  section.set('groups', new Y.Array<YBoardMap>());
  return section;
};
