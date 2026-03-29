import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { MobileDrawer } from '@components/ui';
import { useIsMobile } from '@hooks/useIsMobile';
import type { HistoryRange, HistorySummary } from './queries';
import styles from './DateRangePicker.module.css';

interface DateRangePickerProps {
  range: HistoryRange;
  bounds: HistorySummary | undefined;
  onApply: (range: HistoryRange) => void;
}

type ActiveField = 'start' | 'end';
type InputKey = keyof DraftInputs;

type InputErrors = Partial<Record<InputKey, string>>;

interface DraftRange {
  startDate: string;
  startHour: string;
  endDate: string;
  endHour: string;
}

interface DraftInputs {
  startDateText: string;
  startTimeText: string;
  endDateText: string;
  endTimeText: string;
}

export default function DateRangePicker({ range, bounds, onApply }: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>('start');
  const [errors, setErrors] = useState<InputErrors>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  const boundsRange = useMemo(() => getCustomRangeFromBounds(bounds), [bounds]);
  const effectiveRange = range.start && range.end ? range : boundsRange;
  const draft = useMemo(() => parseDraftRange(effectiveRange), [effectiveRange]);
  const [localDraft, setLocalDraft] = useState<DraftRange>(draft);
  const [inputs, setInputs] = useState<DraftInputs>(buildDraftInputs(draft));
  const visibleMonth = useMemo(
    () => getVisibleMonth(localDraft, boundsRange),
    [boundsRange, localDraft],
  );
  const monthCursor = useMonthCursor(visibleMonth);
  const monthDays = useMemo(() => buildMonthGrid(monthCursor.month), [monthCursor.month]);
  const startBound = bounds?.oldestTs ? new Date(bounds.oldestTs) : null;
  const endBound = bounds?.newestTs ? new Date(bounds.newestTs) : null;
  const validationErrors = useMemo(() => validateInputs(inputs), [inputs]);
  const previewRange = useMemo(() => {
    const parsedDraft = buildDraftFromInputs(inputs);
    if (!parsedDraft) return buildRangeFromDraft(localDraft, startBound, endBound);
    return buildRangeFromDraft(parsedDraft, startBound, endBound);
  }, [endBound, inputs, localDraft, startBound]);
  const appliedPreview = formatTriggerLabel(previewRange);
  const hasErrors = Object.keys(validationErrors).length > 0;

  useEffect(() => {
    syncDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (!open || isMobile) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isMobile, open]);

  function handleOpen() {
    syncDraft(parseDraftRange(effectiveRange));
    setErrors({});
    setActiveField('start');
    setOpen(true);
  }

  function syncDraft(nextDraft: DraftRange) {
    setLocalDraft(nextDraft);
    setInputs(buildDraftInputs(nextDraft));
    setErrors({});
  }

  function handleDateSelect(value: string) {
    const nextDraft =
      activeField === 'start'
        ? { ...localDraft, startDate: value }
        : { ...localDraft, endDate: value };

    setLocalDraft(nextDraft);
    setInputs((prev) =>
      activeField === 'start'
        ? { ...prev, startDateText: formatLongDate(value) }
        : { ...prev, endDateText: formatLongDate(value) },
    );
    setErrors((prev) => {
      const next = { ...prev };
      if (activeField === 'start') delete next.startDateText;
      else delete next.endDateText;
      return next;
    });
    if (activeField === 'start') setActiveField('end');
  }

  function handleApply() {
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const parsedDraft = buildDraftFromInputs(inputs);
    if (!parsedDraft) {
      setErrors(validateInputs(inputs));
      return;
    }

    const normalized = normalizeDraft(parsedDraft, startBound, endBound);
    syncDraft(normalized);
    onApply(buildRangeFromDraft(normalized, startBound, endBound));
    setOpen(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleApply();
  }

  function handleInputChange(key: InputKey, value: string) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function commitDateInput(
    field: 'startDate' | 'endDate',
    key: 'startDateText' | 'endDateText',
    value: string,
  ) {
    const parsed = parseDateInput(value);
    if (!parsed) {
      setErrors((prev) => ({ ...prev, [key]: 'Use YYYY-MM-DD or a valid short date.' }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLocalDraft((prev) => ({ ...prev, [field]: parsed }));
    setInputs((prev) => ({ ...prev, [key]: formatLongDate(parsed) }));
  }

  function commitTimeInput(
    field: 'startHour' | 'endHour',
    key: 'startTimeText' | 'endTimeText',
    value: string,
  ) {
    const parsed = parseTimeInput(value);
    if (parsed == null) {
      setErrors((prev) => ({ ...prev, [key]: 'Use HH:mm, 9, 09:00, or 9pm.' }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLocalDraft((prev) => ({ ...prev, [field]: parsed }));
    setInputs((prev) => ({ ...prev, [key]: formatHour(parsed) }));
  }

  const triggerLabel = formatTriggerLabel(effectiveRange);
  const canGoPrev = canMoveMonth(monthCursor.month, -1, startBound);
  const canGoNext = canMoveMonth(monthCursor.month, 1, endBound);
  const pickerBody = (
    <form className={styles.panelBody} onSubmit={handleSubmit}>
      <div className={styles.inputsRow}>
        <FieldBlock
          label="Start"
          dateValue={inputs.startDateText}
          timeValue={inputs.startTimeText}
          dateError={errors.startDateText}
          timeError={errors.startTimeText}
          onDateChange={(value) => handleInputChange('startDateText', value)}
          onTimeChange={(value) => handleInputChange('startTimeText', value)}
          onDateCommit={(value) => commitDateInput('startDate', 'startDateText', value)}
          onTimeCommit={(value) => commitTimeInput('startHour', 'startTimeText', value)}
          onFocus={() => setActiveField('start')}
        />

        <FieldBlock
          label="End"
          dateValue={inputs.endDateText}
          timeValue={inputs.endTimeText}
          dateError={errors.endDateText}
          timeError={errors.endTimeText}
          onDateChange={(value) => handleInputChange('endDateText', value)}
          onTimeChange={(value) => handleInputChange('endTimeText', value)}
          onDateCommit={(value) => commitDateInput('endDate', 'endDateText', value)}
          onTimeCommit={(value) => commitTimeInput('endHour', 'endTimeText', value)}
          onFocus={() => setActiveField('end')}
        />
      </div>

      <div className={styles.topRow}>
        <span className={styles.timezoneBadge}>UTC</span>
        <button
          type="button"
          className={styles.fullRangeBtn}
          onClick={() => syncDraft(parseDraftRange(boundsRange))}
        >
          Full range
        </button>
      </div>

      <div className={styles.calendarHeader}>
        <button
          type="button"
          className={styles.navBtn}
          disabled={!canGoPrev}
          onClick={() => monthCursor.shiftMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className={styles.monthLabel}>{formatMonthLabel(monthCursor.month)}</span>
        <button
          type="button"
          className={styles.navBtn}
          disabled={!canGoNext}
          onClick={() => monthCursor.shiftMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className={styles.weekdays}>
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className={styles.calendarGrid}>
        {monthDays.map((day) => {
          const isOutside = day.slice(0, 7) !== monthCursor.month;
          const isDisabled = isDateDisabled(day, startBound, endBound);
          const selected = getDateSelection(day, localDraft);
          return (
            <button
              key={day}
              type="button"
              className={styles.dayCell}
              data-outside={isOutside || undefined}
              data-disabled={isDisabled || undefined}
              data-selected={selected || undefined}
              disabled={isDisabled}
              onClick={() => handleDateSelect(day)}
            >
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span className={styles.preview}>{appliedPreview}</span>
        <button type="submit" className={styles.applyBtn} disabled={hasErrors}>
          Apply
        </button>
      </div>
    </form>
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" className={styles.trigger} onClick={handleOpen}>
        <span className={styles.triggerIcon}>▦</span>
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        <span className={styles.triggerChevron}>▾</span>
      </button>

      {open && !isMobile ? <div className={styles.panel}>{pickerBody}</div> : null}

      {isMobile ? (
        <MobileDrawer open={open} onClose={() => setOpen(false)} title="History Range">
          {pickerBody}
        </MobileDrawer>
      ) : null}
    </div>
  );
}

interface FieldBlockProps {
  label: string;
  dateValue: string;
  timeValue: string;
  dateError?: string;
  timeError?: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onDateCommit: (value: string) => void;
  onTimeCommit: (value: string) => void;
  onFocus: () => void;
}

function FieldBlock({
  label,
  dateValue,
  timeValue,
  dateError,
  timeError,
  onDateChange,
  onTimeChange,
  onDateCommit,
  onTimeCommit,
  onFocus,
}: FieldBlockProps) {
  return (
    <div className={styles.fieldBlock}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldRow}>
        <div className={styles.inputWrap} data-invalid={dateError || undefined}>
          <input
            className={styles.input}
            value={dateValue}
            placeholder="Mar 25, 2026"
            onChange={(event) => onDateChange(event.target.value)}
            onFocus={onFocus}
            onBlur={(event) => onDateCommit(event.target.value)}
          />
        </div>
        <div className={styles.timeWrap} data-invalid={timeError || undefined}>
          <input
            className={styles.input}
            value={timeValue}
            placeholder="09:00"
            onChange={(event) => onTimeChange(event.target.value)}
            onBlur={(event) => onTimeCommit(event.target.value)}
          />
        </div>
      </div>
      {dateError || timeError ? (
        <span className={styles.errorText}>{dateError ?? timeError}</span>
      ) : null}
    </div>
  );
}

function useMonthCursor(initialMonth: string) {
  const [month, setMonth] = useState(initialMonth);

  useEffect(() => {
    setMonth(initialMonth);
  }, [initialMonth]);

  function shiftMonth(delta: number) {
    setMonth((prev) => {
      const date = new Date(`${prev}-01T00:00:00.000Z`);
      date.setUTCMonth(date.getUTCMonth() + delta);
      return date.toISOString().slice(0, 7);
    });
  }

  return { month, shiftMonth };
}

function buildMonthGrid(month: string): string[] {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const start = new Date(first);
  const dayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - dayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function parseDraftRange(range: HistoryRange): DraftRange {
  const start = range.start ? new Date(range.start) : new Date();
  const end = range.end
    ? new Date(Math.max(new Date(range.end).getTime() - 1, start.getTime()))
    : start;

  return {
    startDate: start.toISOString().slice(0, 10),
    startHour: String(start.getUTCHours()).padStart(2, '0'),
    endDate: end.toISOString().slice(0, 10),
    endHour: String(end.getUTCHours()).padStart(2, '0'),
  };
}

function buildDraftInputs(draft: DraftRange): DraftInputs {
  return {
    startDateText: formatLongDate(draft.startDate),
    startTimeText: formatHour(draft.startHour),
    endDateText: formatLongDate(draft.endDate),
    endTimeText: formatHour(draft.endHour),
  };
}

function buildDraftFromInputs(inputs: DraftInputs): DraftRange | null {
  const startDate = parseDateInput(inputs.startDateText);
  const endDate = parseDateInput(inputs.endDateText);
  const startHour = parseTimeInput(inputs.startTimeText);
  const endHour = parseTimeInput(inputs.endTimeText);

  if (!startDate || !endDate || startHour == null || endHour == null) {
    return null;
  }

  return { startDate, startHour, endDate, endHour };
}

function validateInputs(inputs: DraftInputs): InputErrors {
  const next: InputErrors = {};
  if (!parseDateInput(inputs.startDateText))
    next.startDateText = 'Use YYYY-MM-DD or a valid short date.';
  if (!parseDateInput(inputs.endDateText))
    next.endDateText = 'Use YYYY-MM-DD or a valid short date.';
  if (parseTimeInput(inputs.startTimeText) == null)
    next.startTimeText = 'Use HH:mm, 9, 09:00, or 9pm.';
  if (parseTimeInput(inputs.endTimeText) == null) next.endTimeText = 'Use HH:mm, 9, 09:00, or 9pm.';
  return next;
}

function buildRangeFromDraft(
  draft: DraftRange,
  lowerBound: Date | null,
  upperBound: Date | null,
): HistoryRange {
  const normalized = normalizeDraft(draft, lowerBound, upperBound);
  const start = new Date(`${normalized.startDate}T${normalized.startHour}:00:00.000Z`);
  const end = new Date(`${normalized.endDate}T${normalized.endHour}:59:59.999Z`);

  return {
    start: start.toISOString(),
    end: new Date(end.getTime() + 1).toISOString(),
  };
}

function normalizeDraft(
  draft: DraftRange,
  lowerBound: Date | null,
  upperBound: Date | null,
): DraftRange {
  const next = { ...draft };
  let start = new Date(`${next.startDate}T${next.startHour}:00:00.000Z`);
  let end = new Date(`${next.endDate}T${next.endHour}:59:59.999Z`);

  if (lowerBound && start < lowerBound) start = lowerBound;
  if (upperBound && end > upperBound) end = upperBound;

  if (end < start) {
    end = new Date(start.getTime() + 59 * 60 * 1000 + 59_999);
    if (upperBound && end > upperBound) end = upperBound;
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    startHour: String(start.getUTCHours()).padStart(2, '0'),
    endDate: end.toISOString().slice(0, 10),
    endHour: String(end.getUTCHours()).padStart(2, '0'),
  };
}

function getVisibleMonth(draft: DraftRange, boundsRange: HistoryRange): string {
  return (
    draft.startDate.slice(0, 7) ||
    boundsRange.start?.slice(0, 7) ||
    new Date().toISOString().slice(0, 7)
  );
}

function formatTriggerLabel(range: HistoryRange): string {
  if (!range.start || !range.end) return 'Select history range';
  const end = new Date(new Date(range.end).getTime() - 1).toISOString();
  return `${formatShortDateTime(range.start)} → ${formatShortDateTime(end)}`;
}

function formatShortDateTime(value: string): string {
  const date = new Date(value);
  return `${formatShortDate(date)} ${date.toISOString().slice(11, 16)} UTC`;
}

function formatLongDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatHour(value: string): string {
  return `${value}:00`;
}

function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yearToken = '', monthToken = '', dayToken = ''] = isoMatch;
    return buildExactIsoDate(Number(yearToken), Number(monthToken) - 1, Number(dayToken));
  }

  const monthMatch = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthMatch) {
    const [, monthToken = '', dayToken = '', yearToken = ''] = monthMatch;
    const month = MONTH_INDEX[monthToken.slice(0, 3).toLowerCase()];
    const day = Number(dayToken);
    const year = Number(yearToken);
    if (month == null) return null;
    return buildExactIsoDate(year, month, day);
  }

  return null;
}

function buildExactIsoDate(year: number, monthIndex: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day))
    return null;
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;

  const parsed = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseTimeInput(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const direct = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!direct) return null;

  let hour = Number(direct[1]);
  const minutes = direct[2] ? Number(direct[2]) : 0;
  const meridiem = direct[3];
  if (!Number.isFinite(hour) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59)
    return null;
  if (minutes !== 0) return null;

  if (meridiem === 'AM') {
    if (hour === 12) hour = 0;
  } else if (meridiem === 'PM') {
    if (hour < 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return null;
  return String(hour).padStart(2, '0');
}

function canMoveMonth(month: string, delta: number, bound: Date | null): boolean {
  if (!bound) return true;
  const candidate = new Date(`${month}-01T00:00:00.000Z`);
  candidate.setUTCMonth(candidate.getUTCMonth() + delta);
  const candidateMonth = candidate.toISOString().slice(0, 7);
  const boundMonth = bound.toISOString().slice(0, 7);
  return delta < 0 ? candidateMonth >= boundMonth : candidateMonth <= boundMonth;
}

function isDateDisabled(value: string, lowerBound: Date | null, upperBound: Date | null): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (lowerBound && date < startOfUtcDay(lowerBound)) return true;
  if (upperBound && date > startOfUtcDay(upperBound)) return true;
  return false;
}

function getDateSelection(value: string, draft: DraftRange): 'start' | 'end' | 'in-range' | null {
  const start = draft.startDate;
  const end = draft.endDate;
  if (value === start) return 'start';
  if (value === end) return 'end';
  if (value > start && value < end) return 'in-range';
  return null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function getCustomRangeFromBounds(bounds: HistorySummary | undefined): HistoryRange {
  if (!bounds?.oldestTs || !bounds?.newestTs) return { start: null, end: null };

  const oldest = new Date(bounds.oldestTs);
  const newest = new Date(bounds.newestTs);

  return {
    start: oldest.toISOString(),
    end: new Date(newest.getTime() + 1).toISOString(),
  };
}
