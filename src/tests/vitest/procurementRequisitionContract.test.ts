import { describe, expect, it } from 'vitest';
import { createRequisitionSchema, updateRequisitionSchema } from '../../routes/procurement.schemas';
import { canDeleteRequisition, REQUISITION_PRIORITIES } from '../../lib/procurement/requisitionFields';
import { persianIssueMessage } from '../../lib/validationMessages';

/**
 * v9.0.266 (TD-688، B10-01): قرارداد ثبت درخواست خرید همان بدنه‌ای است که سه فرم رابط می‌فرستند. پیش‌تر Zod مقدار را از
 * `quantity` و اولویت را از `low|medium|high|emergency` می‌خواست: هر سه فرم ۴۰۰ می‌گرفتند و بدنه پذیرفته‌شده مقدار صفر
 * ذخیره می‌کرد.
 */
const parse = (body: unknown) => createRequisitionSchema.safeParse({ body }, { error: persianIssueMessage });

const deskBody = {
  title: 'خرید مهره و ورق برنج', priority: 'urgent', requiredDate: '1405/07/15', notes: '',
  items: [
    { itemId: 12, itemCode: 'R-12', itemName: 'مهره کریستالی', unit: 'عدد', requestedQty: 40, unitPriceEstimate: 2500, notes: '' },
    { itemId: null, itemCode: '', itemName: 'تعمیر دستگاه پرس', unit: 'خدمت', requestedQty: 1, unitPriceEstimate: 0, notes: '' },
  ],
};
const projectShortageBody = {
  title: 'کسری مواد پروژه PRJ-1405-001', projectId: 3, projectCode: 'PRJ-1405-001', projectName: 'گردنبند ماه',
  priority: 'high', requiredDate: '1405/07/20', notes: '',
  items: [{ itemId: 9, itemCode: 'R-9', itemName: 'زنجیر', unit: 'متر', requestedQty: 6, unitPriceEstimate: 1200, notes: '' }],
};
const reorderBody = {
  title: 'سفارش تامین ماده اولیه سیم نقره', priority: 'normal', requiredDate: '1405/07/10', notes: '',
  items: [{ itemId: 7, itemCode: 'R-7', itemName: 'سیم نقره', unit: 'متر', requestedQty: 8, unitPriceEstimate: 1000, notes: 'کسری نقطه سفارش: موجودی فعلی 2 / حد آستانه 10' }],
};

describe('purchase requisition contract (TD-688)', () => {
  it('accepts the bodies of the desk, project shortage and reorder alert forms with their quantities and names', () => {
    for (const body of [deskBody, projectShortageBody, reorderBody]) {
      const result = parse(body);
      expect(result.error?.issues).toBeUndefined();
      expect(result.data?.body.items.map(r => [r.itemName, r.requestedQty])).toEqual(body.items.map(r => [r.itemName, String(r.requestedQty)]));
      expect(result.data?.body.priority).toBe(body.priority);
    }
  });

  it('knows the priorities the forms and the urgent counter use', () => {
    expect([...REQUISITION_PRIORITIES]).toEqual(['urgent', 'high', 'normal', 'low']);
    expect(parse({ ...reorderBody, priority: 'emergency' }).success).toBe(false);
    expect(parse({ ...reorderBody, priority: 'medium' }).success).toBe(false);
    expect(parse({ ...reorderBody, priority: undefined }).data?.body.priority).toBe('normal');
  });

  it('refuses a row without a requested quantity instead of storing zero, and says so in Persian', () => {
    const legacy = parse({ ...reorderBody, items: [{ itemId: 7, quantity: 8 }] });
    expect(legacy.success).toBe(false);
    const zero = parse({ ...reorderBody, items: [{ itemId: 7, requestedQty: 0 }] });
    expect(zero.error?.issues.map(i => i.message).join(' ')).toContain('مقدار درخواستی باید بیشتر از صفر باشد');
    expect(parse({ ...reorderBody, items: [{ itemId: 7, requestedQty: 'سه' }] }).success).toBe(false);
    expect(parse({ ...reorderBody, items: [{ requestedQty: 2 }] }).error?.issues[0]?.message).toContain('نام کالا');
  });

  it('reads Persian digits and keeps the stored row id on edit', () => {
    const persian = parse({ ...reorderBody, items: [{ itemId: 7, requestedQty: '۱۲٫۵', unitPriceEstimate: '۱٬۰۰۰' }] });
    expect(persian.data?.body.items[0]).toMatchObject({ requestedQty: '12.5', unitPriceEstimate: '1000' });
    const edit = updateRequisitionSchema.safeParse({ params: { id: '4' }, body: { items: [{ id: 'item-1791-0', itemId: 7, requestedQty: 3 }] } });
    expect(edit.data?.body.items?.[0]?.id).toBe('item-1791-0');
  });
});

describe('requisition delete button (TD-695)', () => {
  const row = { itemId: 7, requestedQty: 5, orderedQty: 0, receivedQty: 0, linkedDocumentIds: [] as number[] };
  it('offers delete only for a requisition with no order, whatever its status', () => {
    expect(canDeleteRequisition({ status: 'pending', items: [row] })).toBe(true);
    expect(canDeleteRequisition({ status: 'rejected', items: [row] })).toBe(true);
    // a partly ordered requisition (under_review before v9.0.267) and a cancelled one with a live order
    expect(canDeleteRequisition({ status: 'under_review', items: [{ ...row, orderedQty: 2, linkedDocumentIds: [11] }] })).toBe(false);
    expect(canDeleteRequisition({ status: 'rejected', items: [{ ...row, orderedQty: 5, linkedDocumentIds: [12] }] })).toBe(false);
    expect(canDeleteRequisition({ status: 'ordered', items: [row] })).toBe(false);
    expect(canDeleteRequisition({ status: 'received', items: [{ ...row, receivedQty: 5 }] })).toBe(false);
  });
});
