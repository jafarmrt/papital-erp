/**
 * v10.2 package 7 (OBS-R2-24): what the sales page opens from its address and from a sales file's party name.
 *
 * Notifications and the dashboard link to `/crm?leadId=<id>` (a sales file, its won notice) and `/crm?activityId=<id>`
 * (a mention or a due follow-up); the page read neither and opened on its default tab. An activity opens its sales file
 * when it has one, else its party's dossier, else the activity book. A party's dossier opens only for a real party: the
 * file's party id, else the single party whose trimmed name equals the file's party name (letter case ignored); the
 * page never builds a party with id 0 any more, whose dossier read nothing and whose edit button opened an empty form.
 */
export interface CrmDeepLink {
  leadId: number | null;
  activityId: number | null;
}

const positiveId = (raw: string | null): number | null => {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** The sales file or activity the address asks for, or null when it asks for neither */
export function parseCrmDeepLink(search: string): CrmDeepLink | null {
  const params = new URLSearchParams(search);
  const leadId = positiveId(params.get('leadId'));
  const activityId = positiveId(params.get('activityId'));
  return leadId || activityId ? { leadId, activityId } : null;
}

export type ActivityTarget =
  | { kind: 'lead'; leadId: number }
  | { kind: 'party'; customerId: number }
  | { kind: 'activities' };

/** Where an activity opened from a link leads: its sales file, else its party's dossier, else the activity book */
export function activityTarget(activity: { leadId?: number | null; customerId?: number | null }): ActivityTarget {
  const leadId = Number(activity.leadId);
  if (Number.isSafeInteger(leadId) && leadId > 0) return { kind: 'lead', leadId };
  const customerId = Number(activity.customerId);
  if (Number.isSafeInteger(customerId) && customerId > 0) return { kind: 'party', customerId };
  return { kind: 'activities' };
}

const nameKey = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();

/** The party whose dossier a sales file opens: by its id, else the only party of exactly its name; null when none */
export function resolveDossierParty<T extends { id: number; name: string }>(
  lead: { customerId?: number | null; customerName?: string | null },
  parties: readonly T[],
): T | null {
  const list = Array.isArray(parties) ? parties : [];
  const id = Number(lead.customerId);
  if (Number.isSafeInteger(id) && id > 0) return list.find((p) => Number(p.id) === id) ?? null;
  const key = nameKey(lead.customerName);
  if (!key) return null;
  const matches = list.filter((p) => Number(p.id) > 0 && nameKey(p.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

export const DOSSIER_PARTY_MISSING_TEXT = 'این پرونده فروش به طرف حسابی ثبت‌شده پیوند ندارد؛ نخست مشتری را در پرونده انتخاب کنید.';
