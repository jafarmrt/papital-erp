import { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon, Clock } from 'lucide-react';
import { toPersianDigits, toEnglishDigits, getTodayJalaliDate } from '../../utils';

export interface CalendarEventItem {
  id: string | number;
  title: string;
  date: string; // YYYY/MM/DD in Jalali
  time?: string;
  type: 'crm_followup' | 'crm_close' | 'daily_log' | 'task';
  status?: string;
  customerName?: string;
  assignedTo?: string;
  raw?: any;
}

interface InteractiveJalaliCalendarProps {
  events?: CalendarEventItem[];
  onSelectDate?: (date: string) => void;
  onEventClick?: (event: CalendarEventItem) => void;
}

const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد',
  'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر',
  'دی', 'بهمن', 'اسفند'
];

const WEEKDAY_NAMES = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

// Helper to determine days in Jalali month
function getJalaliMonthDaysCount(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  // Is leap year in Jalali
  const leaps = [1, 5, 9, 13, 17, 22, 26, 30];
  const cycleYear = year % 33;
  const isLeap = leaps.includes(cycleYear);
  return isLeap ? 30 : 29;
}

// Convert Jalali year/month/1 to approximate day of week (0 = Sat, 6 = Fri)
function getFirstDayOfWeekInJalaliMonth(year: number, month: number): number {
  try {
    // We create a date string in Persian calendar format and find corresponding weekday
    // By probing Gregorian dates or using an anchor calculation
    // Anchor: 1403/01/01 was Wednesday (day 4 in 0=Sat, 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri)
    // For general robustness, let's use Intl on approximate Gregorian anchor
    const testDate = new Date();
    // Search within +/- 400 days for matching Jalali year and month
    for (let offset = -400; offset <= 400; offset++) {
      const d = new Date(testDate.getTime() + offset * 86400000);
      const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      }).format(d);
      const enParts = toEnglishDigits(parts).split('/');
      if (enParts.length === 3) {
        const y = parseInt(enParts[0], 10);
        const m = parseInt(enParts[1], 10);
        const day = parseInt(enParts[2], 10);
        if (y === year && m === month && day === 1) {
          // JS Date getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
          // Convert to: 0=Sat, 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri
          const jsDay = d.getDay();
          return (jsDay + 1) % 7;
        }
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

export function InteractiveJalaliCalendar({ events = [], onSelectDate, onEventClick }: InteractiveJalaliCalendarProps) {
  const todayStr = getTodayJalaliDate(); // e.g. 1405/06/06
  const [todayYear, todayMonth, todayDay] = useMemo(() => {
    const parts = toEnglishDigits(todayStr).split('/').map((p) => parseInt(p, 10));
    return [parts[0] || 1405, parts[1] || 6, parts[2] || 6];
  }, [todayStr]);

  const [currentYear, setCurrentYear] = useState<number>(todayYear);
  const [currentMonth, setCurrentMonth] = useState<number>(todayMonth);
  const [selectedDay, setSelectedDay] = useState<number>(todayDay);

  const selectedDateStr = useMemo(() => {
    return `${currentYear}/${String(currentMonth).padStart(2, '0')}/${String(selectedDay).padStart(2, '0')}`;
  }, [currentYear, currentMonth, selectedDay]);

  const daysInMonth = useMemo(() => {
    return getJalaliMonthDaysCount(currentYear, currentMonth);
  }, [currentYear, currentMonth]);

  const firstDayOffset = useMemo(() => {
    return getFirstDayOfWeekInJalaliMonth(currentYear, currentMonth);
  }, [currentYear, currentMonth]);

  // Events mapped by day of current month
  const eventsByDay = useMemo(() => {
    const map: Record<number, CalendarEventItem[]> = {};
    const prefix = `${currentYear}/${String(currentMonth).padStart(2, '0')}/`;
    
    events.forEach((ev) => {
      if (ev.date && typeof ev.date === 'string') {
        const normDate = toEnglishDigits(ev.date).replace(/-/g, '/');
        if (normDate.startsWith(prefix)) {
          const dayNum = parseInt(normDate.substring(prefix.length), 10);
          if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
            if (!map[dayNum]) map[dayNum] = [];
            map[dayNum].push(ev);
          }
        }
      }
    });
    return map;
  }, [events, currentYear, currentMonth]);

  const selectedDayEvents = useMemo(() => {
    return eventsByDay[selectedDay] || [];
  }, [eventsByDay, selectedDay]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDay(1);
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDay(1);
  };

  const handleGoToday = () => {
    setCurrentYear(todayYear);
    setCurrentMonth(todayMonth);
    setSelectedDay(todayDay);
    if (onSelectDate) {
      onSelectDate(todayStr);
    }
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    const dateStr = `${currentYear}/${String(currentMonth).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    if (onSelectDate) {
      onSelectDate(dateStr);
    }
  };

  const monthName = JALALI_MONTH_NAMES[currentMonth - 1] || 'ماه';
  const isCurrentMonthToday = currentYear === todayYear && currentMonth === todayMonth;

  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
      {/* Header with Month / Year and Navigation */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <CalendarIcon size={16} />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>{monthName}</span>
                <span className="text-slate-500 font-normal">{toPersianDigits(currentYear)}</span>
              </h2>
              <p className="text-[10px] text-slate-400">تقویم کاری و سررسید وظایف</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isCurrentMonthToday && (
              <button
                onClick={handleGoToday}
                className="text-[11px] font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
              >
                امروز
              </button>
            )}
            <button
              onClick={handlePrevMonth}
              title="ماه قبل"
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={handleNextMonth}
              title="ماه بعد"
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400 mb-1.5">
          {WEEKDAY_NAMES.map((w, idx) => (
            <div key={idx} className={`py-1 ${idx === 6 ? 'text-rose-400 font-extrabold' : ''}`}>
              {w}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {/* Empty cells before month start */}
          {Array.from({ length: firstDayOffset }).map((_, idx) => (
            <div key={`empty-${idx}`} className="h-8 sm:h-9" />
          ))}

          {/* Days */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const isToday = isCurrentMonthToday && day === todayDay;
            const isSelected = day === selectedDay;
            const dayEvents = eventsByDay[day] || [];
            const hasEvents = dayEvents.length > 0;
            const dayOfWeek = (firstDayOffset + idx) % 7;
            const isFriday = dayOfWeek === 6;

            return (
              <button
                key={`day-${day}`}
                onClick={() => handleDayClick(day)}
                className={`relative h-8 sm:h-9 rounded-xl flex flex-col items-center justify-center text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs font-bold scale-105 z-10'
                    : isToday
                    ? 'bg-blue-50 text-blue-700 font-extrabold border border-blue-200'
                    : isFriday
                    ? 'text-rose-500 hover:bg-rose-50'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{toPersianDigits(day)}</span>

                {/* Event Dots */}
                {hasEvents && (
                  <span className="flex items-center gap-0.5 mt-0.5">
                    {dayEvents.slice(0, 3).map((ev, evIdx) => (
                      <span
                        key={evIdx}
                        className={`w-1 h-1 rounded-full ${
                          isSelected
                            ? 'bg-white'
                            : ev.type === 'crm_followup'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Agenda / Events Preview */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
            <Clock size={12} className="text-slate-400" />
            رویدادهای {toPersianDigits(selectedDateStr)}:
          </span>
          <span className="text-[10px] text-slate-400">
            {toPersianDigits(selectedDayEvents.length)} مورد
          </span>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="text-center py-3 text-slate-400 text-xs bg-slate-50/70 rounded-xl">
            هیچ رویداد یا پیگیری برای این روز ثبت نشده است.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {selectedDayEvents.map((ev, idx) => (
              <div
                key={idx}
                onClick={() => onEventClick && onEventClick(ev)}
                className="p-2 bg-slate-50 hover:bg-blue-50/70 rounded-xl border border-slate-100 text-xs transition-colors cursor-pointer flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      ev.type === 'crm_followup' ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                  />
                  <div className="truncate">
                    <p className="font-bold text-slate-800 truncate">{ev.title}</p>
                    {ev.customerName && (
                      <p className="text-[10px] text-slate-500 truncate">مشتری: {ev.customerName}</p>
                    )}
                  </div>
                </div>

                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 shrink-0 font-medium">
                  {ev.type === 'crm_followup' ? 'پیگیری' : 'تسک'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
