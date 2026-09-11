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
