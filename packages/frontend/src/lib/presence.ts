/** Awareness identity shown on remote cursors and in the online-users list. */
export interface PresenceUser {
  name: string;
  color: string;
}

const NAMES = ['Luna', 'Nova', 'Astra', 'Orion', 'Leo', 'Cygnus', 'Vesper', 'Sol', 'Draco', 'Lyra'];
const COLORS = ['#6366f1', '#8b5cf6', '#d946ef', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#06b6d4', '#f43f5e'];

/** Pick a random display name and color for this session's awareness state. */
export const randomPresenceUser = (): PresenceUser => ({
  name: NAMES[Math.floor(Math.random() * NAMES.length)],
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
});
