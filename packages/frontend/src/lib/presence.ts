/** Awareness identity shown on remote cursors and in the online-users list. */
export interface PresenceUser {
  name: string;
  color: string;
}

const NAMES = ['Luna', 'Nova', 'Astra', 'Orion', 'Leo', 'Cygnus', 'Vesper', 'Sol', 'Draco', 'Lyra'];
// Muted zen tones, dark enough to carry the white name label on cursors.
const COLORS = ['#557a5c', '#4f6f8f', '#b4622a', '#a95b45', '#4e7c7a', '#8b6f4e', '#5d6b8a', '#7c7f3e', '#6e5f7a', '#3f6650'];

/** Pick a random display name and color for this session's awareness state. */
export const randomPresenceUser = (): PresenceUser => ({
  name: NAMES[Math.floor(Math.random() * NAMES.length)],
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
});
