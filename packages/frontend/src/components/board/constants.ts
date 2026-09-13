/** Section accents from the zen palette: moss, aizome, persimmon, stone. */
export const ACCENTS = ['#6b8f71', '#4f6f8f', '#d0783b', '#737771'];

/**
 * Accents are persisted in each board doc, so sections created before the zen
 * theme still carry the old indigo/purple values. Map those at render time
 * rather than rewriting stored data.
 */
const LEGACY_ACCENTS: Record<string, string> = {
  '#818cf8': ACCENTS[0],
  '#8b5cf6': ACCENTS[1],
  '#a855f7': ACCENTS[2],
  '#c084fc': ACCENTS[3],
};

export const displayAccent = (accent: string) => LEGACY_ACCENTS[accent.toLowerCase()] ?? accent;

export const ARCHIVE_SCROLL_THRESHOLD = 15;
export const FINISH_LONG_PRESS_MS = 550;

/**
 * Solid-fill Tailwind class per calendar tag, shared by the task row dot and
 * the calendar cells. These stay distinct from the zen accents used elsewhere
 * so every tag remains recognizable at a glance.
 */
export const FLAG_FILL_CLASS: Record<import('./types').FlagColor, string> = {
  red: 'bg-flag-red',
  yellow: 'bg-flag-yellow',
  green: 'bg-flag-green',
  blue: 'bg-flag-blue',
  pink: 'bg-flag-pink',
};

/** Format a stored YYYY-MM-DD as a short M/D label without going through Date/timezone conversion. */
export const formatShortDate = (date: string) => {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
};
