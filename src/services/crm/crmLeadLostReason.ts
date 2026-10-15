import { ValidationError } from '../../errors/customErrors.js';
import { lostReasonError } from '../../lib/crm/leadFields.js';

export interface LostReasonInput {
  /** مرحله پرونده پس از این ذخیره */
  targetStage: string;
  /** مرحله پیش از این ذخیره؛ `null` برای پرونده تازه */
  existingStage: string | null;
  existingReason?: string | null;
  existingNote?: string | null;
  reason?: string;
  note?: string;
}

/**
 * v10.1.16 (N-02 بخش ۲، تصمیم ت۶ طرح ارتباط با مشتری): پرونده‌ای که به «از دست رفته» می‌رود دلیلی از `CRM_LOST_REASONS`
 * می‌خواهد و «سایر» شرح هم می‌خواهد؛ بی آن ۴۲۲ `CRM_LEAD_LOST_REASON_REQUIRED` پیش از هر نوشتن. پرونده‌ای که از دست رفته
 * می‌ماند دلیلش را نگه می‌دارد (پرونده‌های پیش از این نسخه بی دلیل ویرایش‌پذیر می‌مانند) و دلیل فرستاده را با همان قاعده
 * می‌گیرد؛ پرونده‌ای که از «از دست رفته» بیرون می‌آید دلیلش پاک می‌شود.
 */
export function resolveLeadLostReason(input: LostReasonInput): { lostReason: string; lostReasonNote: string } {
  if (input.targetStage !== 'lost') return { lostReason: '', lostReasonNote: '' };
  const entering = input.existingStage !== 'lost';
  if (!entering && input.reason === undefined && input.note === undefined) {
    return { lostReason: input.existingReason ?? '', lostReasonNote: input.existingNote ?? '' };
  }
  const reason = input.reason ?? (entering ? undefined : input.existingReason ?? undefined);
  const note = input.note ?? (entering ? '' : input.existingNote ?? '');
  const error = lostReasonError(reason, note);
  if (error) throw new ValidationError(error, { field: 'lostReason' }, 'CRM_LEAD_LOST_REASON_REQUIRED');
  return { lostReason: String(reason), lostReasonNote: String(note).trim() };
}
