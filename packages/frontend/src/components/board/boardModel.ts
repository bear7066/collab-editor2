import type { ArchiveEntry, BoardSection, BoardState, BoardTask, FlagColor } from './types';

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

/** Strict YYYY-MM-DD check: right shape and an actual day on the calendar. */
export const isValidDateString = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const FLAG_SEVERITY: Record<FlagColor, number> = { red: 3, yellow: 2, green: 1 };

/** The most severe flag in the list (red > yellow > green), or null if empty. */
export const worstFlag = (flags: FlagColor[]): FlagColor | null =>
  flags.reduce<FlagColor | null>((worst, flag) => (!worst || FLAG_SEVERITY[flag] > FLAG_SEVERITY[worst] ? flag : worst), null);

export interface FlaggedTask {
  task: BoardTask;
  /** [section name, group owner] — enough to place the task without re-searching the board. */
  crumb: string[];
}

/**
 * Every task or subtask across the whole board (all sections, not just the
 * open one) that carries both a date and a flag — the calendar only shows
 * color, so a task missing either half of that pair has nothing to plot.
 */
export const collectFlaggedTasks = (sections: BoardSection[]): FlaggedTask[] => {
  const out: FlaggedTask[] = [];
  const walk = (tasks: BoardTask[], crumb: string[]) => {
    for (const task of tasks) {
      if (task.date && task.flag) out.push({ task, crumb });
      if (task.children.length > 0) walk(task.children, crumb);
    }
  };
  for (const section of sections) {
    for (const group of section.groups) walk(group.tasks, [section.name, group.owner]);
  }
  return out;
};

/** Date -> worst flag among tasks due that day, for coloring calendar cells. */
export const colorsByDate = (flaggedTasks: FlaggedTask[]): Map<string, FlagColor> => {
  const byDate = new Map<string, FlagColor[]>();
  for (const { task } of flaggedTasks) {
    const date = task.date as string;
    const list = byDate.get(date) ?? [];
    list.push(task.flag as FlagColor);
    byDate.set(date, list);
  }
  const result = new Map<string, FlagColor>();
  for (const [date, flags] of byDate) {
    const worst = worstFlag(flags);
    if (worst) result.set(date, worst);
  }
  return result;
};
