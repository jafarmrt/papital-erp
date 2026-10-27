/**
 * v11 phase 6.3p (U17): which leads can issue a proforma, shared by the server and the CRM screens. A closed lead («فروش
 * موفق» or «از دست رفته», by stage or status) keeps its state and takes no proforma (TD-932). Any open lead without a
 * proforma can issue one: the conversion moves it to «پیش‌فاکتور و پیشنهاد». Before, the screens offered it only at that
 * stage, and the quick «پیش‌فاکتور» button elsewhere only logged an activity.
 */
export interface LeadStageRef {
  stage?: string | null;
  status?: string | null;
}

export function isClosedLead(lead: LeadStageRef): boolean {
  return ['won', 'lost'].includes(String(lead.stage)) || ['won', 'lost'].includes(String(lead.status));
}

export function canIssueLeadProforma(lead: LeadStageRef & { hasProforma?: number | boolean | null }): boolean {
  return !isClosedLead(lead) && Number(lead.hasProforma ?? 0) !== 1;
}
