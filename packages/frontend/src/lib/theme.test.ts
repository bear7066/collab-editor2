import { describe, expect, test } from 'bun:test';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  nextPreference,
  readPreference,
  resolveTheme,
  writePreference,
  type ThemePreference,
} from './theme';

const storageWith = (value: string | null) => {
  const data = new Map<string, string>();
  if (value !== null) data.set(THEME_STORAGE_KEY, value);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, next: string) => void data.set(key, next),
    removeItem: (key: string) => void data.delete(key),
    read: () => data.get(THEME_STORAGE_KEY) ?? null,
  };
};

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('nextPreference', () => {
  test('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });
});

describe('resolveTheme', () => {
  test('follows the system setting only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('readPreference', () => {
  test('reads a stored preference', () => {
    expect(readPreference(storageWith('dark'))).toBe('dark');
  });

  test('falls back to system for missing, unknown or unreadable storage', () => {
    expect(readPreference(storageWith(null))).toBe('system');
    expect(readPreference(storageWith('sepia'))).toBe('system');
    expect(readPreference(throwingStorage)).toBe('system');
    expect(readPreference(null)).toBe('system');
  });
});

describe('writePreference', () => {
  test('persists the preference', () => {
    const storage = storageWith(null);
    writePreference(storage, 'light');
    expect(storage.read()).toBe('light');
  });

  test('survives storage that refuses to write', () => {
    expect(() => writePreference(throwingStorage, 'dark' as ThemePreference)).not.toThrow();
  });
});

describe('applyTheme', () => {
  test('stamps the resolved theme on the root element', () => {
    const root = { dataset: {} as Record<string, string> };
    applyTheme(root as unknown as HTMLElement, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root as unknown as HTMLElement, 'light');
    expect(root.dataset.theme).toBe('light');
  });
});
