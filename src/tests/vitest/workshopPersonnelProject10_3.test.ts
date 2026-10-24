import { describe, expect, it } from 'vitest';
import { computeProgressMatrix, matrixProducts } from '../../lib/projects/progressMatrix';
import { productRowItemId, scheduleProductItemId } from '../../lib/workshop/scheduleWorkProgress';

/**
 * 10.3 package 6 (TD-1386): the workshop, personnel and project fixes that have a pure rule. The database side of each one
 * is in the regression suite (`reg_project_progress_same_item_rows_td_1386` and the others named in the TD row).
 */
describe('10.3 package 6: progress matrix rows of one item (review N6 of #329)', () => {
  const stages = [{ stageOrder: 1, title: 'برش' }, { stageOrder: 2, title: 'رنگ' }];

  it('reads two product rows of one item as one matrix product, quantities added and optional stages joined', () => {
    const products = matrixProducts({
      products: [
        { id: 'a', item_id: 7, item_code: 'N-7', item_name: 'گردنبند', quantity: 10, unit: 'عدد' },
        { id: 'b', item_id: 9, item_code: 'N-9', item_name: 'دستبند', quantity: 3 },
        { id: 'c', itemId: '7', item_code: '', item_name: '', quantity: 5, selected_optional_stages: ['رنگ'] },
        { id: 'd', item_name: 'بی کالا', quantity: 2 },
      ],
    });
    expect(products.map(p => [p.itemId, p.quantity])).toEqual([[7, 15], [9, 3], [null, 2]]);
    expect(products[0]).toMatchObject({ itemCode: 'N-7', itemName: 'گردنبند', unit: 'عدد', selectedOptionalStages: ['رنگ'] });
  });

  it('gives the merged product one line in the matrix, so one tick and one cell of work', () => {
    const products = matrixProducts({ products: [{ id: 'a', item_id: 7, quantity: 10 }, { id: 'b', item_id: 7, quantity: 5 }] });
    const matrix = computeProgressMatrix(products, stages, [{ itemId: 7, stageOrder: 1, status: 'completed' }], [
      { itemId: 7, stageOrder: 2, unit: 'عدد', planned: 10, done: 10 },
      { itemId: 7, stageOrder: 2, unit: 'عدد', planned: 5, done: 0 },
    ]);
    expect(matrix.products).toHaveLength(1);
    expect(matrix.totalCells).toBe(2);
    expect(matrix.completedCells).toBe(1);
    expect(matrix.products[0].cells[1].work).toMatchObject({ planned: 15, done: 10 });
    expect(matrix.stageCounts.map(s => [s.applicableCount, s.completedCount])).toEqual([[1, 1], [1, 0]]);
  });

  it('keeps the first row of an item in its place and leaves the rows of other items as they were', () => {
    const products = matrixProducts({ products: [{ item_id: 3, quantity: 1 }, { item_id: 4, quantity: 1 }, { item_id: 3, quantity: 2 }] });
    expect(products.map(p => [p.itemId, p.quantity])).toEqual([[3, 3], [4, 1]]);
  });
});

describe('10.3 package 6: the item of a schedule product (review N7 of #329)', () => {
  it('reads item_id, itemId and the legacy item_id_raw by one rule', () => {
    expect(productRowItemId({ item_id: 5 })).toBe(5);
    expect(productRowItemId({ itemId: '6' })).toBe(6);
    expect(productRowItemId({ item_id_raw: 8 })).toBe(8);
    expect(productRowItemId({ item_id: null, item_id_raw: 8 })).toBe(8);
    expect(productRowItemId({ item_id: 0 })).toBeNull();
    expect(productRowItemId({ item_id: '' })).toBeNull();
    // an emptied item_id of an older row does not hide the item it still names (review of #380)
    expect(productRowItemId({ item_id: '', item_id_raw: 8 })).toBe(8);
    expect(productRowItemId({ item_id: 0, itemId: 7 })).toBe(7);
    expect(productRowItemId(null)).toBeNull();
  });

  it('maps a schedule product key to the item_id_raw of its product row, as the matrix does', () => {
    const products = [{ id: 'p1', item_id_raw: 50 }, { id: 'p2' }];
    expect(scheduleProductItemId(products, 9, 'p1')).toBe(50);
    expect(scheduleProductItemId(products, 9, 'p2')).toBeNull();
    expect(matrixProducts({ products })[0].itemId).toBe(50);
  });
});

describe('10.3 package 6: service refusals are AppErrors with a code (decision t5 A)', () => {
  it('names a broken task code sequence with its code instead of a bare Error', async () => {
    const { allocatePieceworkTaskCode } = await import('../../services/piecework/taskCode');
    const { AppError } = await import('../../errors/customErrors');
    const executor = { execute: async () => ({ rows: [{ num: 'x1' }] }) } as unknown as Parameters<typeof allocatePieceworkTaskCode>[0];
    const err = await allocatePieceworkTaskCode(executor, new Set()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 500, code: 'PIECEWORK_TASK_CODE_SEQUENCE_INVALID' });
  });

  it('refuses a voucher correction without a reason or rows as a 422 with its code, before any database work', async () => {
    const { VoucherService } = await import('../../services/accounting/voucher.service');
    const row = { accountId: 1, debit: 1, credit: 0 };
    await expect(VoucherService.correctVoucher({ voucherId: 1, reason: ' ', newItems: [row, row] }))
      .rejects.toMatchObject({ statusCode: 422, code: 'VOUCHER_CORRECTION_REASON_REQUIRED' });
    await expect(VoucherService.correctVoucher({ voucherId: 1, reason: 'غلط تایپی', newItems: [row] }))
      .rejects.toMatchObject({ statusCode: 422, code: 'VOUCHER_CORRECTION_ROWS_REQUIRED' });
  });
});

describe('10.3 package 6: the personnel Excel import names the export columns it does not read', () => {
  it('lists the salary, flag and end-of-service columns a sheet holds, in the export order, whatever their spacing', async () => {
    const { unreadPersonnelColumns, unreadPersonnelColumnsNotice } = await import('../../lib/personnel/personnelImportCells');
    const headers = ['کد پرسنلی', 'نام', 'مشمول عیدی', ' حقوق  ماهانه ', 'مشمول‌بیمه', 'ملیت', 'تاريخ پايان همکاری'];
    const columns = unreadPersonnelColumns(headers);
    expect(columns).toEqual(['تاریخ پایان همکاری', 'حقوق ماهانه', 'مشمول بیمه', 'مشمول عیدی']);
    expect(unreadPersonnelColumnsNotice(columns)).toContain('«حقوق ماهانه»');
    expect(unreadPersonnelColumnsNotice(columns)).toContain('خوانده نمی‌شوند');
    expect(unreadPersonnelColumns(['کد پرسنلی', 'نام', 'ملیت'])).toEqual([]);
    expect(unreadPersonnelColumnsNotice([])).toBeNull();
  });
});
