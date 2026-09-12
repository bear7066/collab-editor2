import React, { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  applyTheme,
  localStorageOrNull,
  nextPreference,
  readPreference,
  resolveTheme,
  writePreference,
  type ThemePreference,
} from '../lib/theme';

const ICONS: Record<ThemePreference, React.ReactNode> = {
  system: <Monitor size={16} />,
  light: <Sun size={16} />,
  dark: <Moon size={16} />,
};

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: follow system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

/** Cycles system → light → dark, remembering the choice on this device. */
export const ThemeToggle: React.FC<{ variant?: 'bare' | 'pill' }> = ({ variant = 'bare' }) => {
  const [preference, setPreference] = useState<ThemePreference>(() => readPreference(localStorageOrNull()));

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(document.documentElement, resolveTheme(preference, media.matches));
    apply();
    if (preference !== 'system') return undefined;

    // Only the system preference tracks later changes to the OS setting.
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next = nextPreference(current);
      writePreference(localStorageOrNull(), next);
      return next;
    });
  }, []);

  const className =
    variant === 'pill'
      ? 'shrink-0 flex items-center justify-center rounded-xl border border-line bg-surface p-2 text-stone transition hover:text-ink cursor-pointer'
      : 'flex items-center text-stone hover:text-ink transition cursor-pointer';

  return (
    <button type="button" onClick={cycle} className={className} title={LABELS[preference]} aria-label={LABELS[preference]}>
      {ICONS[preference]}
    </button>
  );
};
