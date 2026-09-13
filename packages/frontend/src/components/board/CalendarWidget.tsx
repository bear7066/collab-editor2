import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { FLAG_FILL_CLASS } from './constants';
import { colorsByDate, collectFlaggedTasks } from './boardModel';
import type { BoardSection, FlagColor } from './types';

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateKey = (year: number, month: number, day: number) => `${year}-${pad2(month + 1)}-${pad2(day)}`;

interface CalendarWidgetProps {
  /** Every section on the board, not just the one currently open — the widget gives a whole-board overview. */
  sections: BoardSection[];
}

/**
 * A color-only month heatmap: cells carry no text, only the worst flag among
 * that day's tagged tasks (red > yellow > green). Clicking a day opens the
 * actual task list below the grid, where real text is fine to show.
 */
export const CalendarWidget: React.FC<CalendarWidgetProps> = ({ sections }) => {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const flaggedTasks = useMemo(() => collectFlaggedTasks(sections), [sections]);
  const colors = useMemo(() => colorsByDate(flaggedTasks), [flaggedTasks]);

  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => dateKey(cursor.year, cursor.month, i + 1)),
  ];

  const shiftMonth = (delta: number) =>
    setCursor((current) => {
      const next = current.month + delta;
      if (next < 0) return { year: current.year - 1, month: 11 };
      if (next > 11) return { year: current.year + 1, month: 0 };
      return { year: current.year, month: next };
    });

  const tasksOnSelectedDate = selectedDate ? flaggedTasks.filter((entry) => entry.task.date === selectedDate) : [];

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-stone">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <div key={`blank_${index}`} aria-hidden="true" />;
          const color = colors.get(date);
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              aria-label={date}
              aria-pressed={selectedDate === date}
              className={`aspect-square rounded transition cursor-pointer ${
                color ? `${FLAG_FILL_CLASS[color]} hover:opacity-80` : 'bg-sunken hover:bg-line-strong'
              } ${date === todayKey ? 'ring-2 ring-ai ring-offset-1 ring-offset-surface' : ''}`}
            />
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-3 rounded-lg border border-line bg-paper p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone">{selectedDate}</span>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="text-stone transition hover:text-ink cursor-pointer"
              aria-label="Close day detail"
            >
              <X size={12} />
            </button>
          </div>
          {tasksOnSelectedDate.length === 0 ? (
            <div className="text-xs text-stone-light">No tagged items.</div>
          ) : (
            <ul className="space-y-1.5">
              {tasksOnSelectedDate.map(({ task, crumb }) => (
                <li key={task.id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${FLAG_FILL_CLASS[task.flag as FlagColor]}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-ink-soft">{task.text}</div>
                    <div className="truncate font-mono text-[10px] text-stone-light">{crumb.join(' > ')}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

export default CalendarWidget;
