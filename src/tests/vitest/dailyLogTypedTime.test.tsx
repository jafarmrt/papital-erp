import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimeOfDayInput } from '../../components/daily-logs/TimeOfDayInput';
import { DailyLogModal } from '../../components/daily-logs/DailyLogModal';
import { afternoonEndTime, normalizeTimeOfDay, timeOfDayReading, workHoursBetween, workTimeError } from '../../lib/dailyLogs/workHours';
import { createDailyLogSchema } from '../../routes/dailyLogs.schemas';

// v11 (owner request 8 Aban 1405): a work time is typed with digits only on a phone's number pad, and an end written
// as «۲» after a morning start is read as ۱۴:۰۰ and shown in words.

afterEach(cleanup);

describe('typed work times', () => {
  it('reads digits alone as a time, in any digit script', () => {
    expect(normalizeTimeOfDay('8')).toBe('08:00');
    expect(normalizeTimeOfDay('۱۴')).toBe('14:00');
    expect(normalizeTimeOfDay('۸۳۰')).toBe('08:30');
    expect(normalizeTimeOfDay('١٤٠٠')).toBe('14:00');
    expect(normalizeTimeOfDay('0830')).toBe('08:30');
    expect(normalizeTimeOfDay('8:30')).toBe('08:30');
    expect(normalizeTimeOfDay('۱۷:۰۵')).toBe('17:05');
    expect(normalizeTimeOfDay('۸٫۳۰')).toBe('08:30');
    expect(normalizeTimeOfDay('8.30')).toBe('08:30');
  });

  it('still refuses what is not a time', () => {
    for (const bad of ['24', '2400', '875', '12345', '8:5', '8.5', '8/30', 'ساعت', '']) {
      expect(workTimeError(bad, '17:00')).not.toBeNull();
    }
    expect(workTimeError('8', '17')).toBeNull();
    expect(workHoursBetween('۸۳۰', '۱۷')).toBe(8.5);
  });

  it('reads an early end after a later start as the afternoon', () => {
    expect(afternoonEndTime('08:00', '02:00')).toBe('14:00');
    expect(afternoonEndTime('8', '5')).toBe('17:00');
    expect(afternoonEndTime('09:30', '09:15')).toBe('21:15');
    // an end already after the start, a start in the afternoon, an end at 00:xx or 12:xx: left alone
    expect(afternoonEndTime('08:00', '10:00')).toBe('10:00');
    expect(afternoonEndTime('14:00', '01:00')).toBe('01:00');
    expect(afternoonEndTime('08:00', '00:30')).toBe('00:30');
    expect(afternoonEndTime('13:00', '12:00')).toBe('12:00');
    expect(afternoonEndTime('bad', '02:00')).toBe('02:00');
  });

  it('shows a time in words', () => {
    expect(timeOfDayReading('14:00')).toBe('۲ بعدازظهر');
    expect(timeOfDayReading('08:30')).toBe('۸:۳۰ صبح');
    expect(timeOfDayReading('12:00')).toBe('۱۲ ظهر');
    expect(timeOfDayReading('00:15')).toBe('۱۲:۱۵ بامداد');
    expect(timeOfDayReading('18:00')).toBe('۶ عصر');
    expect(timeOfDayReading('21:00')).toBe('۹ شب');
    expect(timeOfDayReading('x')).toBeNull();
  });

  it('the server reads typed digits the same way', () => {
    const body = { date: '1405/08/08', start_time: '۸۳۰', end_time: '1700', title: 'ع', content: 'م' };
    const parsed = createDailyLogSchema.shape.body.safeParse(body);
    expect(parsed.success && parsed.data.start_time).toBe('08:30');
    expect(parsed.success && parsed.data.end_time).toBe('17:00');
    const bad = createDailyLogSchema.shape.body.safeParse({ ...body, start_time: '2400' });
    expect(bad.success).toBe(false);
  });

  it('the box keeps what is typed, stores HH:MM and shows the time in words', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimeOfDayInput label="ساعت پایان" value="17:00" onChange={onChange} />);
    const input = screen.getByLabelText('ساعت پایان') as HTMLInputElement;
    expect(input.inputMode).toBe('numeric');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '۱۴' } });
    expect(onChange).toHaveBeenLastCalledWith('14:00');
    rerender(<TimeOfDayInput label="ساعت پایان" value="14:00" onChange={onChange} />);
    expect(input.value).toBe('۱۴');
    fireEvent.blur(input);
    expect(input.value).toBe('۱۴:۰۰');
    expect(screen.getByText('۲ بعدازظهر')).toBeTruthy();
  });
});

describe('the log form reads only a typed end as the afternoon', () => {
  const props = (setFormEndTime: (v: string) => void, setFormStartTime: (v: string) => void) => ({
    isModalOpen: true, onClose: () => undefined, editingLog: null, formDate: '1405/08/08', setFormDate: () => undefined,
    formStartTime: '08:00', setFormStartTime, formEndTime: '10:00', setFormEndTime,
    formWorkMode: 'onsite' as const, setFormWorkMode: () => undefined, formTitle: '', setFormTitle: () => undefined,
    formContent: '', setFormContent: () => undefined, formProjectId: '', setFormProjectId: () => undefined,
    formVisibility: 'mentioned_only' as const, setFormVisibility: () => undefined, formMentions: [], formTags: [],
    tagInput: '', setTagInput: () => undefined, currentFormHours: 2, isSaving: false,
    user: { id: 3, username: 'writer', full_name: 'نویسنده', role: 'custom_role' }, systemUsers: [], projects: [],
    onAddTag: () => undefined, onRemoveTag: () => undefined, onSaveLog: () => undefined,
  });

  it('an end typed as «۲» is stored as 14:00; a changed start leaves the stored end alone', () => {
    const setEnd = vi.fn();
    const setStart = vi.fn();
    render(<DailyLogModal {...props(setEnd, setStart)} />);
    const end = screen.getByLabelText('ساعت پایان');
    fireEvent.focus(end);
    fireEvent.change(end, { target: { value: '۲' } });
    expect(setEnd).toHaveBeenLastCalledWith('14:00');
    setEnd.mockClear();
    const start = screen.getByLabelText('ساعت شروع');
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: '۱۳' } });
    fireEvent.blur(start);
    expect(setStart).toHaveBeenLastCalledWith('13:00');
    expect(setEnd).not.toHaveBeenCalled();
  });
});
