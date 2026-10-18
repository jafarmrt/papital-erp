import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { DomainEventType } from './domainEvents.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/index.js';

/**
 * 10.2 package 8 (TD-1297, review M-3): the treasury event carries no amount, so the seeded rule «ثبت ممیزی
 * تراکنش‌های کلان خزانه‌داری» (`payload.amount gte 500000000`) would no longer match. It is the one saved rule the boot
 * rewrites (an exception to TD-715 the review chose): only while it still holds exactly its seeded condition, it is
 * moved to `payload.isHighValue eq true`, whose threshold «آستانه تراکنش کلان خزانه» is 500,000,000 rials by default,
 * and its seeded texts lose the amount; one audit row with the condition before and after, in the same transaction
 * under the rule row lock. A rule the owner changed (another condition, name or event type) is left as it is and is
 * listed by the financial health check (`event_rule_treasury_private_fields`).
 */
export const HIGH_VALUE_TREASURY_RULE_NAME = 'ثبت ممیزی تراکنش‌های کلان خزانه‌داری';
export const HIGH_VALUE_TREASURY_RULE_DESCRIPTION = 'ثبت ردیف ممیزی امنیتی اختصاصی برای هر دریافت یا پرداخت خزانه که ارزش ریالی آن دست‌کم «آستانه تراکنش کلان خزانه» در تنظیمات باشد (پیش‌فرض ۵۰۰ میلیون ریال)';
export const HIGH_VALUE_TREASURY_RULE_CONDITIONS = [{ field: 'payload.isHighValue', operator: 'eq', value: true }];
export const HIGH_VALUE_TREASURY_RULE_TEMPLATE = 'تراکنش کلان خزانه‌داری به ارز {{payload.currency}} به ثبت رسید.';

const SEEDED_CONDITIONS = [{ field: 'payload.amount', operator: 'gte', value: 500000000 }];
const SEEDED_DESCRIPTION = 'ثبت لاگ ممیزی امنیتی اختصاصی برای کلیه تراکنش‌های واریز یا برداشت بالای ۵۰۰ میلیون ریال';
const SEEDED_TEMPLATE = 'تراکنش خزانه‌داری با ارزش کلان {{payload.amount}} {{payload.currency}} به ثبت رسید.';

function isSeededCondition(conditions: unknown): boolean {
  if (!Array.isArray(conditions) || conditions.length !== 1) return false;
  const [c] = conditions as Array<Record<string, unknown>>;
  return !!c && typeof c === 'object' && Object.keys(c).length === 3
    && c.field === SEEDED_CONDITIONS[0].field && c.operator === SEEDED_CONDITIONS[0].operator
    && Number(c.value) === SEEDED_CONDITIONS[0].value;
}

/**
 * the number of rules moved to `isHighValue` (0 when none still holds the seeded condition); a failure is logged and
 * never stops the boot, like the seeding of the default rules
 */
export async function repairSeededHighValueTreasuryRule(): Promise<number> {
  try {
    return await moveSeededRules();
  } catch (err: unknown) {
    logger.error(`[EventActionEngine] High-value treasury rule repair failed: ${errorMessageOf(err)}`);
    return 0;
  }
}

async function moveSeededRules(): Promise<number> {
  return orm.transaction(async (tx) => {
    const candidates = await tx.select().from(eventActionRules)
      .where(and(eq(eventActionRules.name, HIGH_VALUE_TREASURY_RULE_NAME), eq(eventActionRules.eventType, DomainEventType.TREASURY_TRANSACTION_APPROVED)))
      .for('update');
    let repaired = 0;
    for (const rule of candidates) {
      if (!isSeededCondition(rule.conditionsJson)) continue;
      const config = { ...((rule.actionConfigJson ?? {}) as Record<string, unknown>) };
      if (config.descriptionTemplate === SEEDED_TEMPLATE) config.descriptionTemplate = HIGH_VALUE_TREASURY_RULE_TEMPLATE;
      const description = rule.description === SEEDED_DESCRIPTION ? HIGH_VALUE_TREASURY_RULE_DESCRIPTION : rule.description;
      await tx.update(eventActionRules)
        .set({
          conditionsJson: HIGH_VALUE_TREASURY_RULE_CONDITIONS as typeof rule.conditionsJson,
          actionConfigJson: config as typeof rule.actionConfigJson,
          description,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(eventActionRules.id, rule.id));
      await logActivity({
        tx,
        action: 'UPDATE',
        entity: `قانون واکنش خودکار #${rule.id}`,
        entityId: rule.id,
        description: `قانون «${rule.name}» به‌جای مبلغ تراکنش، نشانه «تراکنش کلان» را می‌سنجد`,
        details: {
          before: { conditionsJson: rule.conditionsJson, descriptionTemplate: (rule.actionConfigJson as Record<string, unknown> | null)?.descriptionTemplate ?? null },
          after: { conditionsJson: HIGH_VALUE_TREASURY_RULE_CONDITIONS, descriptionTemplate: config.descriptionTemplate ?? null },
        },
      });
      repaired += 1;
    }
    return repaired;
  });
}
