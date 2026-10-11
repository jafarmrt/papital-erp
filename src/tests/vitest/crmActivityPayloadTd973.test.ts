import { describe, expect, it } from 'vitest';
import { activityPayload } from '../../lib/crm/activityPayload';

// v10.0.31 (TD-973): recording an activity keeps its party
describe('CRM activity payload keeps the party (TD-973)', () => {
  const form = { title: 'call', customerId: 42 as number | null };

  it('keeps the party the form was opened for when there is no lead', () => {
    expect(activityPayload(form, null)).toMatchObject({ leadId: null, customerId: 42 });
  });

  it('takes the lead party when the lead has one', () => {
    expect(activityPayload(form, { id: 7, customerId: 9 })).toMatchObject({ leadId: 7, customerId: 9 });
  });

  it('keeps the form party when the lead has none', () => {
    expect(activityPayload(form, { id: 7, customerId: null })).toMatchObject({ leadId: 7, customerId: 42 });
  });

  it('sends no party when neither has one', () => {
    expect(activityPayload({ title: 'x', customerId: null }, undefined)).toMatchObject({ leadId: null, customerId: null });
  });
});
