import type { ArchiveEntry, BoardSection, BoardState, BoardTask, FlagColor, RecurrenceRule } from './types';

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

const FLAG_SEVERITY: Record<FlagColor, number> = { red: 5, yellow: 4, green: 3, blue: 2, pink: 1 };

/** The highest-priority flag in the list, or null if empty. */
export const worstFlag = (flags: FlagColor[]): FlagColor | null =>
  flags.reduce<FlagColor | null>((worst, flag) => (!worst || FLAG_SEVERITY[flag] > FLAG_SEVERITY[worst] ? flag : worst), null);

export interface FlaggedTask {
  task: BoardTask;
  /** The specific calendar date this entry represents — a one-off task's own
   * date, or (for a recurring task) one expanded occurrence. */
  date: string;
  /** [section name, group owner] — enough to place the task without re-searching the board. */
  crumb: string[];
}

/**
 * Every non-recurring task or subtask across the whole board (all sections,
 * not just the open one) that carries both a date and a flag — the calendar
 * only shows color, so a task missing either half of that pair has nothing
 * to plot. Recurring tasks are handled by collectRecurringOccurrences instead.
 */
export const collectFlaggedTasks = (sections: BoardSection[]): FlaggedTask[] => {
  const out: FlaggedTask[] = [];
  const walk = (tasks: BoardTask[], crumb: string[]) => {
    for (const task of tasks) {
      if (task.date && task.flag && !task.recur) out.push({ task, date: task.date, crumb });
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
  for (const { date, task } of flaggedTasks) {
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

export interface TimedLayoutInput {
  id: string;
  start: number;
  end: number;
}

export interface TimedLayout extends TimedLayoutInput {
  column: number;
  columns: number;
}

/**
 * Assign side-by-side columns to timed items. Transitive overlaps stay in one
 * cluster, while items that only touch at an edge may reuse the same column.
 */
export const layoutOverlappingEvents = (items: TimedLayoutInput[]): TimedLayout[] => {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const result: TimedLayout[] = [];
  let cluster: Array<TimedLayoutInput & { column: number }> = [];
  let clusterEnd = -Infinity;
  let activeEnds: number[] = [];

  const flush = () => {
    const columns = Math.max(1, ...cluster.map((item) => item.column + 1));
    result.push(...cluster.map((item) => ({ ...item, columns })));
    cluster = [];
    activeEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    let column = activeEnds.findIndex((end) => end <= item.start);
    if (column === -1) column = activeEnds.length;
    activeEnds[column] = item.end;
    cluster.push({ ...item, column });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length > 0) flush();
  return result;
};

/** Today's calendar date in the viewer's local time zone (not UTC), as YYYY-MM-DD. */
export const todayDateKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar-date strings carry no time zone, so all arithmetic on them runs in
// UTC — using the local zone would let a date silently drift near midnight.
const parseDateUTC = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const formatDateUTC = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/** The first date on/after `from` that matches the rule's weekday and is on/after its startDate. */
const firstOccurrenceOnOrAfter = (recur: RecurrenceRule, from: string): string => {
  const fromMs = Math.max(parseDateUTC(from), parseDateUTC(recur.startDate));
  const weekday = new Date(fromMs).getUTCDay();
  const daysToAdd = (recur.weekday - weekday + 7) % 7;
  return formatDateUTC(fromMs + daysToAdd * DAY_MS);
};

/** Every date (YYYY-MM-DD) in [rangeStart, rangeEnd] (inclusive) where the rule fires. */
export const occurrencesInRange = (recur: RecurrenceRule, rangeStart: string, rangeEnd: string): string[] => {
  const endMs = parseDateUTC(rangeEnd);
  const results: string[] = [];
  for (let cursor = parseDateUTC(firstOccurrenceOnOrAfter(recur, rangeStart)); cursor <= endMs; cursor += 7 * DAY_MS) {
    results.push(formatDateUTC(cursor));
  }
  return results;
};

/**
 * The occurrence "belonging to now": the most recent matching date on or
 * before `today`, or the first occurrence if the rule has not fired yet.
 * Because completion is tracked per exact date, a new week's occurrence is
 * automatically unfinished — nothing needs to reset it.
 */
export const currentOccurrenceDate = (recur: RecurrenceRule, today: string): string => {
  const todayMs = parseDateUTC(today);
  const startMs = parseDateUTC(recur.startDate);
  if (todayMs < startMs) return firstOccurrenceOnOrAfter(recur, recur.startDate);

  const weekday = new Date(todayMs).getUTCDay();
  const daysSince = (weekday - recur.weekday + 7) % 7;
  const candidateMs = todayMs - daysSince * DAY_MS;
  return candidateMs >= startMs ? formatDateUTC(candidateMs) : firstOccurrenceOnOrAfter(recur, recur.startDate);
};

/**
 * Every recurring, flagged task's occurrences within [rangeStart, rangeEnd] —
 * the calendar's counterpart to collectFlaggedTasks for one-off dates.
 */
export const collectRecurringOccurrences = (
  sections: BoardSection[],
  rangeStart: string,
  rangeEnd: string
): FlaggedTask[] => {
  const out: FlaggedTask[] = [];
  const walk = (tasks: BoardTask[], crumb: string[]) => {
    for (const task of tasks) {
      if (task.recur && task.flag) {
        for (const date of occurrencesInRange(task.recur, rangeStart, rangeEnd)) out.push({ task, date, crumb });
      }
      if (task.children.length > 0) walk(task.children, crumb);
    }
  };
  for (const section of sections) {
    for (const group of section.groups) walk(group.tasks, [section.name, group.owner]);
  }
  return out;
};
