import { asc, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowDefinitions, workflowStates, workflowTransitions } from '../../db/schema.js';
import { recordDefinitionVersion } from './workflowSnapshot.js';
import { logActivity } from '../../lib/auditLogger.js';

/** نگهبان یک اقدام seed: from، to و کلید اقدام آن را می‌شناسند */
export interface SeedStepGuard {
  from: string;
  to: string;
  actionKey: string;
  title: string;
  requiredRole: string;
  requiredPermission: string;
  /** «آغازکننده تأیید نکند» (TD-392)؛ پیش‌فرض خاموش */
  isInitiatorExcluded?: boolean;
  /** «فقط آغازکننده اجرا کند» (TD-1220)؛ پیش‌فرض خاموش */
  isInitiatorOnly?: boolean;
}

export interface SeedGuardUpgrade {
  code: string;
  /** کلید گام‌های seed، همه */
  stateKeys: readonly string[];
  /** نگهبان‌های seed پیشین؛ فقط تعریفی که دقیقاً همین است ارتقا می‌یابد */
  legacy: ReadonlyArray<SeedStepGuard>;
  /** نگهبان‌های seed تازه با همان from، to و کلید اقدام */
  next: ReadonlyArray<SeedStepGuard>;
  /** شرح نسخه تازه تعریف */
  versionDescription: string;
}

const guardKey = (g: Pick<SeedStepGuard, 'from' | 'to' | 'actionKey'>) => `${g.from}>${g.to}>${g.actionKey}`;

/**
 * v10.0.27 (TD-965؛ الگوی TD-444 / TD-445): seed راه‌اندازی تعریف موجود را ویرایش نمی‌کند (TD-453)، پس نگهبان تازه یک
 * گردش کار پیش‌فرض به نصب موجود فقط با این گام می‌رسد. تعریف زیر قفل ردیفش خوانده می‌شود؛ اگر گام‌ها و اقدام‌ها دقیقاً همان
 * seed پیشین باشند (عنوان، نقش، مجوز، قاعده امضا، شرط، اقدام خودکار و «آغازکننده تأیید نکند»)، فقط نگهبان‌ها روی همان
 * ردیف‌ها نوشته می‌شوند (شناسه‌ها عوض نمی‌شوند) و یک نسخه تازه تعریف ثبت می‌شود. فرایندهای در جریان با تصویر خود ادامه
 * می‌دهند. تعریف ویرایش‌شده دست نمی‌خورد. اجرای دوباره کاری نمی‌کند، چون تعریف دیگر seed پیشین نیست.
 */
export async function upgradeLegacySeedGuards(upgrade: SeedGuardUpgrade): Promise<boolean> {
  return orm.transaction(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions)
      .where(eq(workflowDefinitions.code, upgrade.code)).for('update');
    if (!def) return false;
    const states = await tx.select({ id: workflowStates.id, stateKey: workflowStates.stateKey })
      .from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
    const keyOf = new Map(states.map(s => [s.id, s.stateKey]));
    if (states.map(s => s.stateKey).sort().join(',') !== [...upgrade.stateKeys].sort().join(',')) return false;
    const transitions = await tx.select().from(workflowTransitions)
      .where(eq(workflowTransitions.workflowDefinitionId, def.id)).orderBy(asc(workflowTransitions.id));
    if (transitions.length !== upgrade.legacy.length) return false;

    const legacyByKey = new Map(upgrade.legacy.map(g => [guardKey(g), g]));
    const nextByKey = new Map(upgrade.next.map(g => [guardKey(g), g]));
    const seen = new Set<string>();
    for (const t of transitions) {
      const key = guardKey({ from: keyOf.get(t.fromStateId) ?? '', to: keyOf.get(t.toStateId) ?? '', actionKey: t.actionKey });
      const legacy = legacyByKey.get(key);
      const rules = Array.isArray(t.ruleConditionsJson) ? t.ruleConditionsJson : [];
      const untouched = legacy && nextByKey.has(key) && !seen.has(key)
        && (t.title ?? '') === legacy.title && (t.requiredRole ?? '') === legacy.requiredRole
        && (t.requiredPermission ?? '') === legacy.requiredPermission
        && (t.approvalRuleType ?? 'SINGLE') === 'SINGLE' && rules.length === 0 && !(t.autoActionKey ?? '')
        && Number(t.isInitiatorExcluded ?? 0) === (legacy.isInitiatorExcluded ? 1 : 0)
        && Number(t.isInitiatorOnly ?? 0) === (legacy.isInitiatorOnly ? 1 : 0);
      if (!untouched) return false;
      seen.add(key);
    }

    for (const t of transitions) {
      const guard = nextByKey.get(guardKey({ from: keyOf.get(t.fromStateId) ?? '', to: keyOf.get(t.toStateId) ?? '', actionKey: t.actionKey }));
      if (!guard) return false;
      await tx.update(workflowTransitions)
        .set({
          requiredRole: guard.requiredRole, requiredPermission: guard.requiredPermission,
          isInitiatorExcluded: guard.isInitiatorExcluded ? 1 : 0, isInitiatorOnly: guard.isInitiatorOnly ? 1 : 0,
        })
        .where(eq(workflowTransitions.id, t.id));
    }
    const version = await recordDefinitionVersion(tx, def.id, { title: def.title, description: upgrade.versionDescription });
    await logActivity({
      tx, action: 'UPDATE', entity: 'طرح گردش کار', entityId: def.id,
      description: `ارتقای نگهبان گام‌های گردش کار پیش‌فرض «${def.title}»: ${upgrade.versionDescription}`,
      details: {
        code: upgrade.code, version,
        before: upgrade.legacy.map(g => ({ actionKey: g.actionKey, from: g.from, to: g.to, requiredPermission: g.requiredPermission, isInitiatorExcluded: !!g.isInitiatorExcluded, isInitiatorOnly: !!g.isInitiatorOnly })),
        after: upgrade.next.map(g => ({ actionKey: g.actionKey, from: g.from, to: g.to, requiredPermission: g.requiredPermission, isInitiatorExcluded: !!g.isInitiatorExcluded, isInitiatorOnly: !!g.isInitiatorOnly })),
      },
    });
    return true;
  });
}
