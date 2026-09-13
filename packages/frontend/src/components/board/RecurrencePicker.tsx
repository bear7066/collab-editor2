import React, { useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import type { RecurrenceRule } from './types';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday-first display index -> Date.getDay() weekday (0 = Sunday). */
const JS_WEEKDAY = [1, 2, 3, 4, 5];

const workdayOrMonday = (weekday: number | undefined) =>
  weekday !== undefined && weekday >= 1 && weekday <= 5 ? weekday : 1;

interface RecurrencePickerProps {
  recur: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
}

/** Weekly schedule editor: weekday plus a wall-clock start/end time. */
export const RecurrencePicker: React.FC<RecurrencePickerProps> = ({ recur, onChange }) => {
  const [open, setOpen] = useState(false);
  const [weekday, setWeekday] = useState(workdayOrMonday(recur?.weekday));
  const [startTime, setStartTime] = useState(recur?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(recur?.endTime ?? '10:00');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setWeekday(workdayOrMonday(recur?.weekday));
    setStartTime(recur?.startTime ?? '09:00');
    setEndTime(recur?.endTime ?? '10:00');
    setError('');
  }, [open, recur]);

  const save = () => {
    if (endTime <= startTime) {
      setError('End must be after start.');
      return;
    }
    onChange({ weekday, startDate: recur?.startDate ?? '', startTime, endTime });
    setOpen(false);
  };

  const summary = recur
    ? `${WEEKDAY_NAMES[recur.weekday]} ${recur.startTime ?? '09:00'}–${recur.endTime ?? '10:00'}`
    : 'Repeat weekly';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded p-1 transition cursor-pointer ${
          recur ? 'text-moss-deep' : 'text-stone hover:bg-sunken hover:text-ai'
        }`}
        title={recur ? `${summary}. Click to change.` : summary}
        aria-label={recur ? `${summary}. Click to change.` : summary}
        aria-expanded={open}
      >
        <Repeat size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <div className="mb-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-stone">
            Weekly schedule
          </div>
          <div className="mb-3 flex gap-1">
            {WEEKDAY_LABELS.map((label, index) => {
              const value = JS_WEEKDAY[index];
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setWeekday(value)}
                  aria-pressed={weekday === value}
                  aria-label={`Every ${WEEKDAY_NAMES[value]}`}
                  className={`flex h-7 w-7 items-center justify-center rounded font-label text-[10px] font-semibold transition cursor-pointer ${
                    weekday === value ? 'bg-moss-deep text-on-moss' : 'text-stone hover:bg-sunken hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="font-label text-[10px] text-stone">
              Start
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ai"
              />
            </label>
            <label className="font-label text-[10px] text-stone">
              End
              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ai"
              />
            </label>
          </div>
          {error && <p className="mt-2 text-[11px] text-shu">{error}</p>}
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-xs text-stone transition hover:text-shu cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-moss-deep px-3 py-1.5 text-xs font-semibold text-on-moss transition hover:opacity-90 cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurrencePicker;
