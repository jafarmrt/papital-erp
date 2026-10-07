import { describe, expect, it } from 'vitest';
import {
  isScheduleRowLogged, keepScheduleLogLinks, scheduleLogItem, withPieceworkTask, withScheduleLogLink, withScheduleRowIds, withoutScheduleLogLink,
} from '../../lib/projects/scheduleWorkLog';

const row = { taskId: null, taskTitle: '', assignedPersonnelId: 7, quantity: 10 };

// v9.0.272 (TD-735, decision t4 «الف»): the workshop schedule reads the server's `defaultRate` and sends no rate
describe('work logs of the project workshop schedule (TD-735)', () => {
  it('takes the base rate from defaultRate, the key the server sends', () => {
    const picked = withPieceworkTask(row, { id: 3, title: 'مونتاژ گردنبند', defaultRate: 50000, unit: 'عدد' });
    expect(picked).toMatchObject({ taskId: 3, taskTitle: 'مونتاژ گردنبند', defaultRate: 50000, estimatedCost: 500000, unit: 'عدد' });
  });

  it('posts the schedule row reference and no rate', () => {
    const item = scheduleLogItem({
      projectId: 12, ref: { stageId: 4, productId: 'prod-main', rowId: 'task-1' },
      row: { ...row, taskId: 3, taskTitle: 'مونتاژ', defaultRate: 0 }, date: '2026-10-07', notes: 'کارکرد',
    });
    expect(item).toEqual({
      personnelId: 7, taskId: 3, projectId: 12, date: '2026-10-07', quantity: 10, notes: 'کارکرد',
      scheduleRef: { stageId: 4, productId: 'prod-main', rowId: 'task-1' },
    });
    expect('unitRate' in item).toBe(false);
  });
});

const schedule = (tasks: Array<Record<string, unknown>>) => ({ 1: { 'prod-main': { productId: 'prod-main', tasks } } });
const rowsOf = (s: unknown) => (s as { 1: { 'prod-main': { tasks: Array<Record<string, unknown>> } } })[1]['prod-main'].tasks;

// v9.0.273 (TD-736, decision t5 «الف»): the server writes the log id into the schedule row; the browser never sets it
describe('schedule row log links (TD-736)', () => {
  it('reads a row as logged from the server log id or the legacy flag', () => {
    expect(isScheduleRowLogged({ pieceworkLogId: 12 })).toBe(true);
    expect(isScheduleRowLogged({ isLoggedToPiecework: true })).toBe(true);
    expect(isScheduleRowLogged({ pieceworkLogId: 0 })).toBe(false);
    expect(isScheduleRowLogged({})).toBe(false);
    expect(isScheduleRowLogged(null)).toBe(false);
  });

  it('keeps the saved links and drops the ones the browser sends', () => {
    const saved = schedule([{ id: 'a', pieceworkLogId: 5 }, { id: 'b' }]);
    const incoming = schedule([{ id: 'a', quantity: 3 }, { id: 'b', pieceworkLogId: 5 }, { id: 'c', isLoggedToPiecework: true }]);
    expect(rowsOf(keepScheduleLogLinks(incoming, saved))).toEqual([{ id: 'a', quantity: 3, pieceworkLogId: 5 }, { id: 'b' }, { id: 'c' }]);
    expect(rowsOf(keepScheduleLogLinks(incoming, null))).toEqual([{ id: 'a', quantity: 3 }, { id: 'b' }, { id: 'c' }]);
  });

  it('links one row and unlinks the rows of a deleted log', () => {
    const linked = withScheduleLogLink(schedule([{ id: 'a' }, { id: 'b' }]), { stageId: 1, productId: 'prod-main', rowId: 'b' }, 9);
    expect(rowsOf(linked)).toEqual([{ id: 'a' }, { id: 'b', pieceworkLogId: 9 }]);
    expect(withoutScheduleLogLink(linked, 8).changed).toBe(false);
    const freed = withoutScheduleLogLink(linked, 9);
    expect(freed.changed).toBe(true);
    expect(rowsOf(freed.schedules)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('gives rows without an id one before logging and keeps existing ids', () => {
    let n = 0;
    const withIds = withScheduleRowIds(schedule([{ id: 'a' }, { quantity: 1 }, { id: '' }]), () => `new-${++n}`);
    expect(rowsOf(withIds).map(r => r.id)).toEqual(['a', 'new-1', 'new-2']);
  });
});
