// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeUnmetWorkflowRule, describeWorkflowRule, workflowFieldLabel } from '../../lib/workflowRuleText';

describe('workflowRuleText (TD-085)', () => {
  it('describes comparison rules in Persian with Persian digits', () => {
    expect(describeWorkflowRule({ field: 'totalAmount', operator: 'gt', value: 50000000 })).toBe('مبلغ کل بیشتر از ۵۰٬۰۰۰٬۰۰۰ باشد');
    expect(describeWorkflowRule({ field: 'itemCount', operator: 'lte', value: '3' })).toBe('تعداد اقلام حداکثر ۳ باشد');
    expect(describeWorkflowRule({ field: 'currency', operator: 'in', value: ['IRR', 'USD'] })).toBe('ارز یکی از IRR، USD باشد');
  });

  it('describes unary rules without a value', () => {
    expect(describeWorkflowRule({ field: 'notes', operator: 'is_not_empty' })).toBe('توضیحات خالی نباشد');
  });

  it('adds the current value to an unmet rule', () => {
    expect(describeUnmetWorkflowRule({ field: 'amount', operator: 'gte', value: 1000 }, null)).toBe('مبلغ دست‌کم ۱٬۰۰۰ باشد (مقدار فعلی: خالی)');
  });

  it('strips context prefixes and keeps unknown field names', () => {
    expect(workflowFieldLabel('payload.amount')).toBe('مبلغ');
    expect(workflowFieldLabel('customField')).toBe('customField');
  });
});
