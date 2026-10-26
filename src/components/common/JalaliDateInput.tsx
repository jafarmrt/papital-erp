import { useEffect, useRef, useState } from 'react';
import DatePicker from 'react-multi-date-picker';
import type { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { extractDateString, isoToJalaliDate, toStorageDate } from '../../utils';

/**
 * v7.0.136 (TD-232): ورودی تاریخ شمسی برای فرم‌هایی که تاریخ را میلادی ISO نگه می‌دارند.
 * کاربر تقویم شمسی می‌بیند؛ value و onChange همیشه ISO (`YYYY-MM-DD`) یا '' هستند.
 * جایگزین `<input type="date">` که تقویم میلادی مرورگر را نشان می‌داد.
 */
interface JalaliDateInputProps {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
  containerClassName?: string;
  calendarPosition?: string;
  disabled?: boolean;
  /** Id of the text field, so a `<label htmlFor>` names it (v10.1.31, TD-1278). */
  id?: string;
}

/** The picker's own handle: only the method this input calls */
interface PickerHandle { closeCalendar?: () => void }

export function JalaliDateInput({ value, onChange, placeholder, className, containerClassName = 'w-full', calendarPosition = 'bottom-right', disabled, id }: JalaliDateInputProps) {
  const pickerRef = useRef<PickerHandle | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // v11 phase 6.3a (U11, rule TD-1277): Esc with the calendar open closes only the calendar. The window's Esc listener
  // (dialogEscapeStack) runs on `window` in the bubble phase and skips a handled key, so this capture listener marks the
  // key handled first; before, Esc in the calendar closed the whole «پروژهٔ جدید» window and the typed fields were lost.
  useEffect(() => {
    if (!calendarOpen) return undefined;
    const closeCalendarOnly = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      pickerRef.current?.closeCalendar?.();
      setCalendarOpen(false);
    };
    window.addEventListener('keydown', closeCalendarOnly, true);
    return () => window.removeEventListener('keydown', closeCalendarOnly, true);
  }, [calendarOpen]);
  return (
    <DatePicker
      ref={pickerRef}
      onOpen={() => { setCalendarOpen(true); }}
      onClose={() => { setCalendarOpen(false); }}
      value={isoToJalaliDate(value) || ''}
      onChange={(d: DateObject | null) => onChange(d ? (toStorageDate(extractDateString(d)) || '') : '')}
      calendar={persian}
      locale={persian_fa}
      format="YYYY/MM/DD"
      calendarPosition={calendarPosition}
      placeholder={placeholder}
      inputClass={className}
      containerClassName={containerClassName}
      disabled={disabled}
      id={id}
    />
  );
}
