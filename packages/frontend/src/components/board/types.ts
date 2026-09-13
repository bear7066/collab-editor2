export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type PendingFinishStatus = 'done' | 'cancelled';
/** Calendar tag; only three levels, worst-wins when a day has several. */
export type FlagColor = 'red' | 'yellow' | 'green';

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
   * field existed — read as null, never as a crash.
   */
  date?: string | null;
  flag?: FlagColor | null;
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
