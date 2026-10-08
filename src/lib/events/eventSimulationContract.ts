/**
 * v9.0.385 (TD-708، B15-06، تصمیم ت۵ الف): پاسخ «شبیه‌سازی بی‌اثر رویداد» (`POST /events/domain-events/simulate`)، مشترک
 * سرور (`simulateDomainEvent`) و پیشخوان رویدادها (`EventSimulationPanel`). رویداد منتشر نمی‌شود؛ فقط نشان داده می‌شود
 * کدام قانون فعال جور می‌شد و چه می‌کرد و کدام اشتراک وب‌هوک فعال آن را دریافت می‌کرد.
 */
export interface SimulatedRuleOutcome {
  ruleId: number;
  ruleName: string;
  actionType: string;
  matched: boolean;
  /** what the action would have done; null when the conditions do not match */
  preview: Record<string, unknown> | null;
  /** why the rule's action could not run (an invalid stored configuration), else null */
  problem: string | null;
}

export interface SimulatedWebhookOutcome {
  subscriptionId: number;
  name: string;
  targetUrl: string;
}

export interface SimulatedEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}

export interface EventSimulationResult {
  simulated: true;
  event: SimulatedEvent;
  rules: SimulatedRuleOutcome[];
  webhooks: SimulatedWebhookOutcome[];
  message: string;
}

/**
 * آنچه اقدام یک قانون *انجام می‌داد*، به زبان کاربر (پیش‌نمایش `previewRuleAction`): روش و نشانی وب‌هوک، عنوان، متن و شمار
 * گیرندگان اعلان، متن ممیزی.
 */
export function actionPreviewLines(preview: Record<string, unknown> | null | undefined): string[] {
  if (!preview) return [];
  const lines: string[] = [];
  const text = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
  if (preview.url) lines.push(`درخواست ${text(preview.method) || 'POST'} به ${text(preview.url)} فرستاده می‌شد`);
  if (preview.title) lines.push(`عنوان اعلان: ${text(preview.title)}`);
  if (preview.message) lines.push(`متن اعلان: ${text(preview.message)}`);
  if (typeof preview.recipientCount === 'number') lines.push(`شمار گیرندگان اعلان: ${preview.recipientCount.toLocaleString('fa-IR')}`);
  if (preview.description) lines.push(`متن ممیزی: ${text(preview.description)}`);
  return lines;
}
