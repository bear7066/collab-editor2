import React, { useState } from 'react';
import { Repeat } from 'lucide-react';
import type { RecurrenceRule } from './types';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Monday-first display index -> Date.getDay() weekday (0 = Sunday). */
const JS_WEEKDAY = [1, 2, 3, 4, 5, 6, 0];

interface RecurrencePickerProps {
  recur: RecurrenceRule | null;
  onChange: (weekday: number | null) => void;
}

/** A "Repeat" icon that opens a Monday-first weekday row, matching the calendar's header. */
export const RecurrencePicker: React.FC<RecurrencePickerProps> = ({ recur, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded p-1 transition cursor-pointer ${
          recur ? 'text-moss-deep' : 'text-stone hover:bg-sunken hover:text-ai'
        }`}
        title={recur ? 'Repeats weekly. Click to change.' : 'Repeat weekly'}
        aria-label={recur ? 'Repeats weekly. Click to change.' : 'Repeat weekly'}
        aria-expanded={open}
      >
        <Repeat size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          {WEEKDAY_LABELS.map((label, index) => {
            const weekday = JS_WEEKDAY[index];
            const active = recur?.weekday === weekday;
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onChange(active ? null : weekday);
                  setOpen(false);
                }}
                aria-pressed={active}
                aria-label={`Repeat every ${label}`}
                className={`flex h-6 w-6 items-center justify-center rounded font-label text-[10px] font-semibold transition cursor-pointer ${
                  active ? 'bg-moss-deep text-on-moss' : 'text-stone hover:bg-sunken hover:text-ink'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RecurrencePicker;
