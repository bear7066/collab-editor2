import { describe, expect, test } from 'bun:test';
import { colorsByDate, collectFlaggedTasks, isValidDateString, worstFlag } from './boardModel';
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
    expect(collectFlaggedTasks(sections)).toEqual([{ task: t, crumb: ['General', 'Harry'] }]);
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
    expect(collectFlaggedTasks(sections)).toEqual([{ task: child, crumb: ['General', 'Harry'] }]);
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
