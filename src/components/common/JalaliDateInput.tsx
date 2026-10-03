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
}

export function JalaliDateInput({ value, onChange, placeholder, className, containerClassName = 'w-full', calendarPosition = 'bottom-right' }: JalaliDateInputProps) {
  return (
    <DatePicker
      value={isoToJalaliDate(value) || ''}
      onChange={(d: DateObject | null) => onChange(d ? (toStorageDate(extractDateString(d)) || '') : '')}
      calendar={persian}
      locale={persian_fa}
      format="YYYY/MM/DD"
      calendarPosition={calendarPosition}
      placeholder={placeholder}
      inputClass={className}
      containerClassName={containerClassName}
    />
  );
}
