import { describe, expect, test } from 'bun:test';
import {
  colorsByDate,
  collectFlaggedTasks,
  collectRecurringOccurrences,
  currentOccurrenceDate,
  isValidDateString,
  occurrencesInRange,
  worstFlag,
} from './boardModel';
import type { BoardSection, BoardTask } from './types';

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  id: 'task_1',
  text: 'a task',
  status: 'todo',
  starred: false,
  percent: null,
  link: null,
  completedAt: null,
  date: null,
  flag: null,
  recur: null,
  recurCompletions: {},
  children: [],
  ...overrides,
});

const section = (overrides: Partial<BoardSection> = {}): BoardSection => ({
  id: 'section_1',
  name: 'General',
  accent: '#000',
  notes: '',
  groups: [],
  ...overrides,
});

describe('isValidDateString', () => {
  test('accepts a real calendar date', () => {
    expect(isValidDateString('2026-09-20')).toBe(true);
  });

  test('rejects malformed strings', () => {
    for (const value of ['', '2026/09/20', '26-09-20', '2026-9-20', 'not-a-date']) {
      expect(isValidDateString(value)).toBe(false);
    }
  });

  test('rejects a day that does not exist on the calendar', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });
});

describe('worstFlag', () => {
  test('red outranks yellow and green', () => {
    expect(worstFlag(['green', 'yellow', 'red'])).toBe('red');
  });

  test('yellow outranks green when there is no red', () => {
    expect(worstFlag(['green', 'yellow'])).toBe('yellow');
  });

  test('returns null for an empty list', () => {
    expect(worstFlag([])).toBeNull();
  });
});

describe('collectFlaggedTasks', () => {
  test('finds a task with both a date and a flag', () => {
    const t = task({ date: '2026-09-20', flag: 'red' });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    expect(collectFlaggedTasks(sections)).toEqual([{ task: t, date: '2026-09-20', crumb: ['General', 'Harry'] }]);
  });

  test('ignores tasks with only a date or only a flag', () => {
    const onlyDate = task({ id: 't1', date: '2026-09-20', flag: null });
    const onlyFlag = task({ id: 't2', date: null, flag: 'green' });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [onlyDate, onlyFlag] }] })];
    expect(collectFlaggedTasks(sections)).toEqual([]);
  });

  test('finds flagged subtasks nested under an unflagged parent', () => {
    const child = task({ id: 'child', date: '2026-09-21', flag: 'yellow' });
    const parent = task({ id: 'parent', children: [child] });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [parent] }] })];
    expect(collectFlaggedTasks(sections)).toEqual([{ task: child, date: '2026-09-21', crumb: ['General', 'Harry'] }]);
  });

  test('aggregates across every section and group in the board, not just one', () => {
    const a = task({ id: 'a', date: '2026-09-20', flag: 'red' });
    const b = task({ id: 'b', date: '2026-09-21', flag: 'green' });
    const sections = [
      section({ id: 's1', name: 'Work', groups: [{ id: 'g1', owner: 'Harry', tasks: [a] }] }),
      section({ id: 's2', name: 'Life', groups: [{ id: 'g2', owner: 'Mel', tasks: [b] }] }),
    ];
    expect(collectFlaggedTasks(sections).map((entry) => entry.task.id).sort()).toEqual(['a', 'b']);
  });

  test('ignores a recurring task even if it also has a one-off date', () => {
    // recur takes precedence; collectRecurringOccurrences is the source of truth for it.
    const t = task({ date: '2026-09-20', flag: 'red', recur: { weekday: 3, startDate: '2026-09-01' } });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    expect(collectFlaggedTasks(sections)).toEqual([]);
  });
});

describe('colorsByDate', () => {
  test('maps each date to its single flag', () => {
    const entries = collectFlaggedTasks([
      section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [task({ date: '2026-09-20', flag: 'green' })] }] }),
    ]);
    expect(colorsByDate(entries)).toEqual(new Map([['2026-09-20', 'green']]));
  });

  test('a date with mixed flags shows the worst one', () => {
    const entries = collectFlaggedTasks([
      section({
        groups: [
          {
            id: 'g1',
            owner: 'Harry',
            tasks: [
              task({ id: 't1', date: '2026-09-20', flag: 'green' }),
              task({ id: 't2', date: '2026-09-20', flag: 'red' }),
              task({ id: 't3', date: '2026-09-20', flag: 'yellow' }),
            ],
          },
        ],
      }),
    ]);
    expect(colorsByDate(entries)).toEqual(new Map([['2026-09-20', 'red']]));
  });
});

describe('occurrencesInRange', () => {
  // 2026-09-01 is a Tuesday; weekday 3 = Wednesday (Date.getDay() convention, 0 = Sunday).
  test('lists every matching weekday within the range', () => {
    expect(occurrencesInRange({ weekday: 3, startDate: '2026-09-01' }, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
  });

  test('excludes occurrences before the rule starts', () => {
    expect(occurrencesInRange({ weekday: 3, startDate: '2026-09-10' }, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
  });

  test('returns nothing when the range ends before the rule starts', () => {
    expect(occurrencesInRange({ weekday: 3, startDate: '2026-10-01' }, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  test('a single-day range that matches returns exactly that day', () => {
    expect(occurrencesInRange({ weekday: 3, startDate: '2026-09-01' }, '2026-09-02', '2026-09-02')).toEqual([
      '2026-09-02',
    ]);
  });
});

describe('currentOccurrenceDate', () => {
  const recur = { weekday: 3, startDate: '2026-09-01' }; // every Wednesday from 2026-09-01

  test('on the occurrence day itself, that day is current', () => {
    expect(currentOccurrenceDate(recur, '2026-09-16')).toBe('2026-09-16');
  });

  test('later in the same week, the occurrence stays the same until the next one', () => {
    expect(currentOccurrenceDate(recur, '2026-09-18')).toBe('2026-09-16');
    expect(currentOccurrenceDate(recur, '2026-09-19')).toBe('2026-09-16');
  });

  test('early in the week, before this week\'s occurrence, the previous week\'s still holds', () => {
    expect(currentOccurrenceDate(recur, '2026-09-15')).toBe('2026-09-09');
  });

  test('before the rule has ever fired, the first occurrence is current', () => {
    expect(currentOccurrenceDate(recur, '2026-08-20')).toBe('2026-09-02');
  });

  test('handles a rule whose start date is not itself on the target weekday', () => {
    // Starts on a Tuesday; the first real Wednesday occurrence is the next day.
    const offsetRecur = { weekday: 3, startDate: '2026-09-01' };
    expect(currentOccurrenceDate(offsetRecur, '2026-09-01')).toBe('2026-09-02');
  });
});

describe('collectRecurringOccurrences', () => {
  test('expands a recurring flagged task into one entry per occurrence in range', () => {
    const t = task({ recur: { weekday: 3, startDate: '2026-09-01' }, flag: 'yellow' });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    const entries = collectRecurringOccurrences(sections, '2026-09-01', '2026-09-30');
    expect(entries.map((e) => e.date)).toEqual(['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']);
    expect(entries[0].task).toBe(t);
    expect(entries[0].crumb).toEqual(['General', 'Harry']);
  });

  test('ignores a recurring task with no flag — nothing to color', () => {
    const t = task({ recur: { weekday: 3, startDate: '2026-09-01' }, flag: null });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    expect(collectRecurringOccurrences(sections, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  test('ignores a plain one-off dated task', () => {
    const t = task({ date: '2026-09-10', flag: 'red' });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    expect(collectRecurringOccurrences(sections, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  test('finds a recurring subtask nested under a plain parent', () => {
    const child = task({ id: 'child', recur: { weekday: 3, startDate: '2026-09-01' }, flag: 'green' });
    const parent = task({ id: 'parent', children: [child] });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [parent] }] })];
    expect(collectRecurringOccurrences(sections, '2026-09-01', '2026-09-07').map((e) => e.task.id)).toEqual(['child']);
  });
});

describe('colorsByDate with recurring occurrences merged in', () => {
  test('a recurring occurrence colors its date same as a one-off task would', () => {
    const t = task({ recur: { weekday: 3, startDate: '2026-09-01' }, flag: 'red' });
    const sections = [section({ groups: [{ id: 'g1', owner: 'Harry', tasks: [t] }] })];
    const entries = [...collectFlaggedTasks(sections), ...collectRecurringOccurrences(sections, '2026-09-01', '2026-09-30')];
    expect(colorsByDate(entries).get('2026-09-16')).toBe('red');
  });
});
