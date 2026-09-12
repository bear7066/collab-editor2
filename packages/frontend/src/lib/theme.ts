export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'collab-editor:theme';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export const nextPreference = (preference: ThemePreference): ThemePreference =>
  ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

export const resolveTheme = (preference: ThemePreference, prefersDark: boolean): Theme =>
  preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;

export function readPreference(storage: PreferenceStorage | null): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    // Storage blocked (private mode, disabled cookies): fall back to the system setting.
    return 'system';
  }
}

export function writePreference(storage: PreferenceStorage | null, preference: ThemePreference) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice just will not survive a reload.
  }
}

/** The no-flash script in index.html stamps the same attribute before first paint. */
export function applyTheme(root: HTMLElement, theme: Theme) {
  root.dataset.theme = theme;
}

export function localStorageOrNull(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
