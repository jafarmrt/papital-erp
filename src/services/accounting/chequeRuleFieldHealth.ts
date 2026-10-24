import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { CHEQUE_PRIVATE_FIELDS } from '../../lib/events/ruleMissingField.js';
import { findPrivateFieldRules, type TreasuryPrivateFieldRuleRow, type TreasuryPrivateFieldUse } from './treasuryRuleFieldHealth.js';

/**
 * 10.3 package 5 (decision ت۴۷ item 3): the cheque status event («تغییر وضعیت چک») no longer carries the cheque's amount
 * or the party's name, like the treasury event (10.2 package 8). A saved rule of that event that reads one of them (or a
 * «*» rule that reads the party name) changes how it behaves, exactly as the treasury check explains; saved rules are
 * never rewritten (TD-715), so each one is listed here until its condition or text changes or it is deleted.
 */
export function findChequePrivateFieldRules(): Promise<TreasuryPrivateFieldRuleRow[]> {
  return findPrivateFieldRules(CHEQUE_PRIVATE_FIELDS);
}

const USE_DETAILS: Record<TreasuryPrivateFieldUse, string> = {
  always_matches: 'شرط روی این بخش (مثل «برابر نیست»، «در فهرست نیست»، «خالی است» یا شرطی درون گروه «نه») اکنون در هر تغییر وضعیت چک برقرار است، پس قانون ممکن است با هر تغییر اجرا شود.',
  never_matches: 'شرط روی این بخش (مثل «بزرگ‌تر از»، «کوچک‌تر از» یا «برابر است») دیگر هرگز برقرار نمی‌شود.',
  text_only: 'این بخش در متن اقدام خالی چاپ می‌شود.',
};

export function buildChequePrivateFieldRuleHealthTest(rows: TreasuryPrivateFieldRuleRow[]): HealthCheckTestResult {
  const count = rows.length;
  const active = rows.filter(r => r.isActive).length;
  const activeAlways = rows.filter(r => r.isActive && r.use === 'always_matches').length;
  const always = rows.filter(r => r.use === 'always_matches').length;
  return {
    id: 'event_rule_cheque_private_fields',
    category: 'system',
    title: 'قانون‌های خودکار چک که مبلغ یا نام طرف حساب می‌خوانند',
    description: 'رویداد تغییر وضعیت چک دیگر مبلغ چک و نام طرف حساب را ندارد؛ شرط «بزرگ‌تر»، «کوچک‌تر» یا «برابر» روی آن‌ها دیگر برقرار نمی‌شود، شرط «برابر نیست»، «در فهرست نیست» یا «خالی است» آن‌ها در هر تغییر وضعیت برقرار است و متن اقدام آن‌ها را خالی چاپ می‌کند. چنین قانونی تا وقتی شرط یا متن آن عوض نشده این‌جا فهرست می‌شود',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, activeAlways * 2),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} قانون خودکار (${toPersianDigits(active)} فعال) مبلغ چک یا نام طرف حساب را می‌خواند که رویداد تغییر وضعیت چک دیگر ندارد${always > 0 ? `؛ شرط ${toPersianDigits(always)} قانون اکنون در هر تغییر وضعیت برقرار است` : ''}. در «اقدام‌های خودکار» شرط آن را عوض کنید یا قانون را حذف کنید.`
      : 'هیچ قانون خودکاری مبلغ چک یا نام طرف حساب را از رویداد تغییر وضعیت چک نمی‌خواند.',
    items: rows.map(r => ({
      id: r.ruleId,
      code: `قانون #${toPersianDigits(r.ruleId)}`,
      title: r.name || `قانون #${toPersianDigits(r.ruleId)}`,
      subtitle: `بخش‌های ناموجود: ${r.fields.join('، ')}`,
      details: `${r.isActive ? 'فعال است.' : 'غیرفعال است.'} ${USE_DETAILS[r.use]}`,
    })),
    metrics: { chequePrivateFieldRules: count, activeChequePrivateFieldRules: active, alwaysMatchingChequeRules: always },
  };
}
