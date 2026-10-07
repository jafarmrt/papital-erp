import { describe, expect, it } from 'vitest';
import { scheduleLogItem, withPieceworkTask } from '../../lib/projects/scheduleWorkLog';

const row = { taskId: null, taskTitle: '', assignedPersonnelId: 7, quantity: 10 };

// v9.0.237 (TD-735, decision t4 «الف»): the workshop schedule reads the server's `defaultRate` and sends no rate
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
