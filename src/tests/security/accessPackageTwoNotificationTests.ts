import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M3 — گیرنده اعلان «دارندگان یک مجوز» است، نه کد نقش (TD-883). اعلان‌ها از مسیر واقعی (ثبت
 * پرونده فروش، موتور قاعده‌ها) فرستاده می‌شوند. هر آزمون روی کد پیشین قرمز است.
 */

const receivers = async (h: Harness, where: string, value: string, userIds: number[]): Promise<Set<number>> => {
  const rows = await h.q(`SELECT DISTINCT user_id FROM notifications WHERE ${where} = $1 AND user_id = ANY($2::int[])`, [value, userIds]);
  return new Set(rows.map(r => Number(r.user_id)));
};

async function createMemberOfRole(h: Harness, role: string): Promise<number> {
  const { createTestUser } = await import('../fixtures/factories.js');
  return (await createTestUser({ role })).id;
}

export async function runAccessPackageTwoNotificationTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_won_lead_notification_by_permission_td_883', 'security', 'td883', 'crm', 'notifications', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_won_lead_notification_by_permission_td_883',
      name: 'v9.0.110: a won sales lead notifies the holders of crm.manage, not five fixed role codes (TD-883)',
      details: 'moving a lead to won through PUT /api/crm/leads/:id notifies a custom role with crm.manage; a user whose role code is sales (one of the old fixed codes) without crm.manage, a crm.view-only user and a deleted holder are not; the sender is never notified',
    }, async (h, wrong) => {
      const holder = await h.sessionWith(['crm.view', 'crm.manage']);
      const other = await h.sessionWith(['crm.view', 'crm.manage']);
      const viewer = await h.sessionWith(['crm.view']);
      const deleted = await h.sessionWith(['crm.view', 'crm.manage']);
      await h.q(`UPDATE users SET is_deleted = 1 WHERE id = $1`, [deleted.userId]);
      const coded = await createMemberOfRole(h, 'sales');
      // a lead with a live proforma may move to «فروش موفق» (TD-309); the move goes through the real route
      const leads = await h.q(`INSERT INTO crm_leads (title, customer_name, stage, has_proforma) VALUES ($1, $2, 'proposal', 1), ($3, $4, 'proposal', 1) RETURNING id`,
        [`معامله ۸۸۳ ${h.tag}`, `مشتری ۸۸۳ ${h.tag}`, `معامله دوم ۸۸۳ ${h.tag}`, `مشتری دوم ۸۸۳ ${h.tag}`]);
      const [first, second] = leads.map(l => Number(l.id));
      const links = [`/crm?leadId=${first}`, `/crm?leadId=${second}`];
      const watched = [holder.userId, other.userId, viewer.userId, deleted.userId, coded];
      try {
        const won = await h.put(`/api/crm/leads/${first}`, { stage: 'won' }, holder);
        if (won.status !== 200) throw new Error(`moving the lead to won returned ${won.status}: ${JSON.stringify(won.body).slice(0, 160)}`);
        const got = await receivers(h, 'link', links[0], watched);
        if (got.has(holder.userId)) wrong.push('the sender was notified about their own won lead');
        if (!got.has(other.userId)) wrong.push('a custom role holding crm.manage was not notified about a won lead');
        const won2 = await h.put(`/api/crm/leads/${second}`, { stage: 'won' });
        if (won2.status !== 200) throw new Error(`moving the second lead to won returned ${won2.status}`);
        const got2 = await receivers(h, 'link', links[1], watched);
        if (!got2.has(holder.userId) || !got2.has(other.userId)) wrong.push('a holder of crm.manage missed the second won lead');
        if (got2.has(coded) || got.has(coded)) wrong.push('a user with the role code sales and no crm.manage was notified');
        if (got2.has(viewer.userId)) wrong.push('a crm.view-only user was notified');
        if (got2.has(deleted.userId)) wrong.push('a deleted user was notified');
      } finally {
        await h.q(`DELETE FROM notifications WHERE link = ANY($1::text[])`, [links]);
        await h.q(`UPDATE crm_leads SET is_deleted = 1 WHERE id = ANY($1::int[])`, [[first, second]]);
        await h.q(`DELETE FROM users WHERE id = $1`, [coded]).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_notification_rule_recipients_by_permission_td_883', 'security', 'td883', 'events', 'notifications', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_notification_rule_recipients_by_permission_td_883',
      name: 'v9.0.110: the default reorder alert reaches the holders of warehouse.view and a rule may target a catalog permission (TD-883)',
      details: 'with the default rules seeded, a reorder event notifies a custom role holding warehouse.view and not a user of the role code warehouse_keeper without it; a rule targeting an unknown permission is refused with 422',
    }, async (h, wrong) => {
      const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
      const { DomainEventType } = await import('../../services/events/domainEvents.js');
      const saved = await h.q(`SELECT * FROM event_action_rules ORDER BY id`);
      const holder = await h.sessionWith(['warehouse.view']);
      const outsider = await h.sessionWith(['crm.view']);
      const keeper = await createMemberOfRole(h, 'warehouse_keeper');
      // the seed warehouse_keeper role without the key: its code alone must not bring the alert
      const [keeperRole] = await h.q(`SELECT permissions FROM roles WHERE code = 'warehouse_keeper'`);
      await h.q(`UPDATE roles SET permissions = '["crm.view"]'::jsonb WHERE code = 'warehouse_keeper'`);
      const item = `کالای ۸۸۳ ${h.tag}`;
      try {
        await h.q(`DELETE FROM event_action_rules`);
        await EventActionEngineService.seedDefaultRules();
        await EventActionEngineService.processEvent({
          eventId: `td883_${h.tag}`, eventType: DomainEventType.INVENTORY_REORDER_ALERT, aggregateType: 'Item', aggregateId: '1',
          payload: { itemName: item, itemCode: `C883-${h.tag}`, warehouseLocation: 'انبار مرکزی', currentStock: 2 },
          metadata: { correlationId: `td883_${h.tag}`, timestamp: new Date().toISOString() }, occurredAt: new Date().toISOString(),
        } as Parameters<typeof EventActionEngineService.processEvent>[0]);
        const rows = await h.q(`SELECT DISTINCT user_id FROM notifications WHERE position($1 in message) > 0`, [item]);
        const got = new Set(rows.map(r => Number(r.user_id)));
        if (!got.has(holder.userId)) wrong.push('a custom role holding warehouse.view did not get the reorder alert');
        if (got.has(keeper)) wrong.push('a user of the role code warehouse_keeper without warehouse.view got the reorder alert');
        if (got.has(outsider.userId)) wrong.push('a user without warehouse.view got the reorder alert');
        await h.q(`DELETE FROM notifications WHERE position($1 in message) > 0`, [item]);

        const refused = await h.post('/api/events/action-rules', {
          name: `قاعده ۸۸۳ ${h.tag}`, eventType: DomainEventType.INVENTORY_REORDER_ALERT, actionType: 'in_app_notification',
          actionConfigJson: { targetPermission: 'warehouse.everything', titleTemplate: 'آزمون', messageTemplate: 'آزمون' },
        });
        if (refused.status !== 422) wrong.push(`a rule targeting an unknown permission returned ${refused.status}, expected 422`);
      } finally {
        await h.q(`DELETE FROM event_action_rules`);
        if (saved.length > 0) await h.q(`INSERT INTO event_action_rules SELECT * FROM json_populate_recordset(NULL::event_action_rules, $1::json)`, [JSON.stringify(saved)]);
        await h.q(`DELETE FROM users WHERE id = $1`, [keeper]).catch(() => undefined);
        if (keeperRole) await h.q(`UPDATE roles SET permissions = $1::jsonb WHERE code = 'warehouse_keeper'`, [JSON.stringify(keeperRole.permissions)]);
      }
    });
  }

  return results;
}
