export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type PendingFinishStatus = 'done' | 'cancelled';
/** Calendar tag color; priority follows the order defined in boardModel. */
export type FlagColor = 'red' | 'yellow' | 'green' | 'blue' | 'pink';

/** Fires weekly on `weekday` (0 = Sunday, matching Date.getDay()), from `startDate` on. */
export interface RecurrenceRule {
  weekday: number;
  startDate: string;
  /** Local wall-clock time. Optional so boards created before the week view remain readable. */
  startTime?: string;
  endTime?: string;
}

export interface BoardTask {
  id: string;
  text: string;
  status: TaskStatus;
  starred: boolean;
  percent: number | null;
  link: string | null;
  completedAt: string | null;
  /**
   * ISO calendar date (YYYY-MM-DD), or absent on tasks created before this
   * field existed — read as null, never as a crash. Ignored when `recur` is
   * set; a recurring task's dates come from expanding the rule instead.
   */
  date?: string | null;
  /** Optional wall-clock range for a one-off dated task. */
  startTime?: string | null;
  endTime?: string | null;
  flag?: FlagColor | null;
  recur?: RecurrenceRule | null;
  /**
   * Per-occurrence completion for a recurring task, keyed by that
   * occurrence's date — never by task.status, so finishing this week's
   * instance does not affect next week's. Absent on non-recurring tasks.
   */
  recurCompletions?: Record<string, 'done' | 'cancelled'>;
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
   * XML serialization of the notes Y.XmlFragment in the doc snapshot; the
   * meeting-log editor binds the fragment directly, so this is never rendered.
   */
  notes: string;
  groups: BoardGroup[];
}

export interface BoardMeta {
  meetLink: string;
  meetSchedule: string;
}

export interface BoardState {
  meta: BoardMeta;
  sections: BoardSection[];
  updatedAt: string;
}

export interface ArchiveEntry {
  task: BoardTask;
  crumb: string[];
}
