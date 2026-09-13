import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { collectFlaggedTasks, collectRecurringOccurrences, layoutOverlappingEvents } from './boardModel';
import type { FlaggedTask } from './boardModel';
import type { BoardSection, FlagColor } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_HEIGHT = 0.8;
const WORKDAY_COUNT = 5;
const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const EVENT_CLASS: Record<FlagColor, string> = {
  red: 'border-flag-red bg-flag-red/85 text-white',
  yellow: 'border-flag-yellow bg-flag-yellow/85 text-ink',
  green: 'border-flag-green bg-flag-green/85 text-white',
  blue: 'border-flag-blue bg-flag-blue/85 text-white',
  pink: 'border-flag-pink bg-flag-pink/85 text-white',
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const formatDateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseTime = (value: string | undefined, fallback: number) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const mondayOf = (date: Date) => {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
};

/** With weekends hidden, Saturday and Sunday open the upcoming workweek. */
const defaultWorkweekStart = (date: Date) => {
  const monday = mondayOf(date);
  if (date.getDay() === 0 || date.getDay() === 6) monday.setDate(monday.getDate() + 7);
  return monday;
};

interface WeekScheduleProps {
  sections: BoardSection[];
}

interface ScheduleEvent {
  id: string;
  entry: FlaggedTask;
  day: number;
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
}

/** Personal-board week view, with overlapping items laid out side by side. */
export const WeekSchedule: React.FC<WeekScheduleProps> = ({ sections }) => {
  const [weekOffset, setWeekOffset] = useState(0);

  // Mounting covers normal in-app navigation; pageshow also covers reopening
  // a browser-cached page with its old React state intact.
  useEffect(() => {
    const resetToCurrentWeek = () => setWeekOffset(0);
    window.addEventListener('pageshow', resetToCurrentWeek);
    return () => window.removeEventListener('pageshow', resetToCurrentWeek);
  }, []);

  const today = new Date();
  const weekStart = defaultWorkweekStart(today);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const dates = Array.from({ length: WORKDAY_COUNT }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS));
  const dateKeys = dates.map(formatDateKey);
  const rangeStart = dateKeys[0];
  const rangeEnd = dateKeys[WORKDAY_COUNT - 1];
  const todayKey = formatDateKey(today);

  const entries = useMemo(() => {
    const oneOff = collectFlaggedTasks(sections).filter(({ date }) => date >= rangeStart && date <= rangeEnd);
    return [...oneOff, ...collectRecurringOccurrences(sections, rangeStart, rangeEnd)];
  }, [sections, rangeStart, rangeEnd]);

  const events = useMemo<ScheduleEvent[]>(
    () =>
      entries.map((entry) => {
        const startLabel = entry.task.recur?.startTime ?? entry.task.startTime ?? '09:00';
        const endLabel = entry.task.recur?.endTime ?? entry.task.endTime ?? '10:00';
        const start = parseTime(startLabel, 9 * 60);
        const end = Math.max(start + 30, parseTime(endLabel, 10 * 60));
        return { id: `${entry.task.id}_${entry.date}`, entry, day: dateKeys.indexOf(entry.date), start, end, startLabel, endLabel };
      }),
    [entries, dateKeys]
  );

  const earliest = events.length > 0 ? Math.min(...events.map(({ start }) => start)) : 8 * 60;
  const latest = events.length > 0 ? Math.max(...events.map(({ end }) => end)) : 20 * 60;
  const dayStart = Math.max(0, Math.min(8 * 60, Math.floor(earliest / 60) * 60));
  const dayEnd = Math.min(24 * 60, Math.max(20 * 60, Math.ceil(latest / 60) * 60));
  const gridHeight = (dayEnd - dayStart) * MINUTE_HEIGHT;
  const hours = Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, index) => dayStart / 60 + index);

  const positionedByDay = useMemo(
    () =>
      Array.from({ length: WORKDAY_COUNT }, (_, day) => {
        const dayEvents = events.filter((event) => event.day === day);
        const layout = layoutOverlappingEvents(dayEvents.map(({ id, start, end }) => ({ id, start, end })));
        return layout.map((position) => ({
          ...dayEvents.find((event) => event.id === position.id)!,
          ...position,
        }));
      }),
    [events]
  );

  const weekLabel = `${dates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${dates[WORKDAY_COUNT - 1].toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }
  )}`;

  return (
    <section className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-stone">Weekly calendar</h2>
          <p className="mt-0.5 text-xs text-stone-light">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="rounded-md px-2 py-1 font-label text-[10px] text-stone transition hover:bg-sunken hover:text-ink cursor-pointer"
          >
            Today
          </button>
          <button type="button" onClick={() => setWeekOffset((value) => value - 1)} className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer" aria-label="Previous week">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => setWeekOffset((value) => value + 1)} className="rounded p-1 text-stone transition hover:bg-sunken hover:text-ink cursor-pointer" aria-label="Next week">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="overflow-hidden pb-1" style={{ touchAction: 'pan-y' }}>
        <div className="w-full min-w-0">
          <div className="grid grid-cols-[34px_repeat(5,minmax(0,1fr))] border-b border-line pb-2 sm:grid-cols-[44px_repeat(5,minmax(0,1fr))]">
            <div />
            {dates.map((date, index) => {
              const key = dateKeys[index];
              return (
                <div key={key} className={`text-center ${key === todayKey ? 'text-ai' : 'text-stone'}`}>
                  <div className="font-label text-[8px] font-semibold tracking-wide sm:text-[9px]">
                    <span className="sm:hidden">{WEEKDAY_LABELS[index][0]}</span>
                    <span className="hidden sm:inline">{WEEKDAY_LABELS[index]}</span>
                  </div>
                  <div className={`mx-auto mt-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] sm:h-6 sm:w-6 sm:text-xs ${key === todayKey ? 'bg-ai text-white' : 'text-ink-soft'}`}>
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative flex" style={{ height: gridHeight }}>
            <div className="relative w-[34px] shrink-0 sm:w-11">
              {hours.map((hour, index) => (
                <span key={hour} className="absolute right-1 -translate-y-1/2 font-label text-[8px] text-stone-light sm:right-2 sm:text-[9px]" style={{ top: index * 60 * MINUTE_HEIGHT }}>
                  {pad2(hour)}:00
                </span>
              ))}
            </div>
            <div className="relative grid min-w-0 flex-1 grid-cols-5 border-l border-line">
              {hours.map((hour, index) => (
                <div key={hour} className="pointer-events-none absolute left-0 right-0 border-t border-line" style={{ top: index * 60 * MINUTE_HEIGHT }} />
              ))}
              {positionedByDay.map((dayEvents, day) => (
                <div key={day} className="relative min-w-0 border-r border-line">
                  {dayEvents.map(({ entry, id, start, end, startLabel, endLabel, column, columns }) => {
                    const completion = entry.task.recurCompletions?.[entry.date];
                    return (
                      <div
                        key={id}
                        className={`absolute overflow-hidden rounded-sm border-l-2 px-0.5 py-1 shadow-sm sm:rounded-md sm:border-l-[3px] sm:px-1.5 ${EVENT_CLASS[entry.task.flag!]} ${completion ? 'opacity-50' : ''}`}
                        style={{
                          top: (start - dayStart) * MINUTE_HEIGHT + 2,
                          height: Math.max(24, (end - start) * MINUTE_HEIGHT - 4),
                          left: `calc(${(column / columns) * 100}% + 2px)`,
                          width: `calc(${100 / columns}% - 4px)`,
                        }}
                        title={`${entry.task.text}\n${startLabel}–${endLabel}\n${entry.crumb.join(' > ')}`}
                      >
                        <div className={`text-[8px] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[9px] ${completion ? 'line-through' : ''}`}>{entry.task.text}</div>
                        <div className="mt-0.5 hidden font-label text-[8px] leading-tight opacity-80 [overflow-wrap:anywhere] sm:block">
                          {startLabel}–{endLabel}
                        </div>
                        {entry.task.recur && <Repeat size={9} className="absolute bottom-1 right-1 opacity-70" aria-label="Repeats weekly" />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {events.length === 0 && (
        <p className="mt-3 text-xs leading-5 text-stone">
          Add a colored tag and set a date or weekly schedule to place an item here.
        </p>
      )}
    </section>
  );
};

export default WeekSchedule;
