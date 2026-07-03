import type { ArchiveEntry, BoardSection, BoardState, BoardTask } from './types';

export const createId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const findSection = (board: BoardState, sectionId: string) =>
  board.sections.find((section) => section.id === sectionId);

export const findTaskDeep = (
  tasks: BoardTask[],
  taskId: string
): { task: BoardTask; list: BoardTask[] } | null => {
  for (const task of tasks) {
    if (task.id === taskId) return { task, list: tasks };
    const found = findTaskDeep(task.children, taskId);
    if (found) return found;
  }
  return null;
};

export const findTaskInSection = (section: BoardSection, taskId: string) => {
  for (const group of section.groups) {
    const found = findTaskDeep(group.tasks, taskId);
    if (found) return found;
  }
  return null;
};

export const activeChildren = (tasks: BoardTask[]) =>
  tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');

export const countActive = (tasks: BoardTask[]): number =>
  tasks.reduce((count, task) => {
    const self = task.status !== 'done' && task.status !== 'cancelled' ? 1 : 0;
    return count + self + countActive(task.children);
  }, 0);

export const countTasks = (tasks: BoardTask[]): number =>
  tasks.reduce((count, task) => count + 1 + countTasks(task.children), 0);

export const collectArchive = (tasks: BoardTask[], crumb: string[]): ArchiveEntry[] => {
  const out: ArchiveEntry[] = [];
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled') {
      out.push({ task, crumb });
    } else if (task.children.length > 0) {
      out.push(...collectArchive(task.children, [...crumb, task.text]));
    }
  }
  return out;
};

export const normalizeLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};
