import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { assertRuleActionTypeAllowed, assertRuleEventTypeAllowed } from './ruleActionTypeGuard.js';

type ActionRuleRow = typeof eventActionRules.$inferSelect;

export const EVENT_RULE_NOT_FOUND = 'EVENT_RULE_NOT_FOUND';

/**
 * v9.0.438 (TD-729، B15-27، الگوی TD-430): وضعیت قانون واکنش خودکار با «وضعیت هدف» تعیین می‌شود، نه برگرداندن دوطرفه:
 * زیر قفل ردیف قانون، تکرار همان وضعیت چیزی را تغییر نمی‌دهد و هر تغییر یک ردیف ممیزی (پیش و پس) در همان تراکنش دارد.
 * پیش‌تر دو کلیک قانون را دو بار برمی‌گرداند (با دو پیام موفق) و تغییر وضعیت ممیزی نداشت.
 */
export async function setRuleActive(id: number, active: boolean, req?: Request): Promise<{ rule: ActionRuleRow; changed: boolean }> {
  return orm.transaction(async (tx) => {
    const [rule] = await tx.select().from(eventActionRules).where(eq(eventActionRules.id, id)).for('update');
    if (!rule) throw new NotFoundError('قانون مورد نظر یافت نشد.', { id }, EVENT_RULE_NOT_FOUND);
    const target = active ? 1 : 0;
    if ((rule.isActive === 1 ? 1 : 0) === target) return { rule, changed: false };

    assertRuleActionTypeAllowed(rule.actionType, { active, changingType: false });
    assertRuleEventTypeAllowed(rule.eventType, { active, changingType: false });
    const [updated] = await tx.update(eventActionRules)
      .set({ isActive: target, updatedAt: new Date().toISOString() })
      .where(eq(eventActionRules.id, id))
      .returning();
    await logActivity({
      tx, req,
      action: 'UPDATE',
      entity: `قانون واکنش خودکار #${id}`,
      entityId: id,
      description: `${active ? 'فعال‌سازی' : 'غیرفعال‌سازی'} قانون «${rule.name}»`,
      details: { before: { isActive: rule.isActive }, after: { isActive: target } },
    });
    return { rule: updated, changed: true };
  });
}
