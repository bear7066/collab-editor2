import React, { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

interface OneOffTimePickerProps {
  startTime?: string | null;
  endTime?: string | null;
  onChange: (range: { startTime: string; endTime: string } | null) => void;
}

/** Wall-clock range editor for a dated task that does not repeat. */
export const OneOffTimePicker: React.FC<OneOffTimePickerProps> = ({ startTime, endTime, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startTime ?? '09:00');
  const [draftEnd, setDraftEnd] = useState(endTime ?? '10:00');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftStart(startTime ?? '09:00');
    setDraftEnd(endTime ?? '10:00');
    setError('');
  }, [open, startTime, endTime]);

  const save = () => {
    if (!draftStart || !draftEnd || draftEnd <= draftStart) {
      setError('End must be after start.');
      return;
    }
    onChange({ startTime: draftStart, endTime: draftEnd });
    setOpen(false);
  };

  const hasTime = Boolean(startTime && endTime);
  const summary = hasTime ? `${startTime}–${endTime}` : 'Set time';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`mt-0.5 rounded transition cursor-pointer ${
          hasTime
            ? 'border border-line-strong px-2 py-0.5 font-label text-[11px] text-stone hover:border-stone hover:text-ink'
            : 'p-1 text-stone hover:bg-sunken hover:text-ai'
        }`}
        title={hasTime ? `${summary}. Click to change.` : summary}
        aria-label={hasTime ? `${summary}. Click to change.` : summary}
        aria-expanded={open}
      >
        {hasTime ? summary : <Clock3 size={14} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <div className="mb-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-stone">
            One-time schedule
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="font-label text-[10px] text-stone">
              Start
              <input
                type="time"
                value={draftStart}
                onChange={(event) => setDraftStart(event.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ai"
              />
            </label>
            <label className="font-label text-[10px] text-stone">
              End
              <input
                type="time"
                value={draftEnd}
                onChange={(event) => setDraftEnd(event.target.value)}
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

export default OneOffTimePicker;
