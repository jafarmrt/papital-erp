/**
 * v10.0.21 (TD-973): the body of `POST /crm/activities` from the activity form. The party is the lead's party when
 * the activity belongs to a lead with one, else the party the form was opened for (customer dossier, follow-up card).
 * Before, the hook always sent `lead?.customerId || null`, so an activity recorded from a customer's dossier without a
 * lead lost its party and vanished from that customer's history.
 */
export interface ActivityFormParty {
  customerId?: number | null;
}

export interface ActivityLead {
  id: number;
  customerId?: number | null;
}

export function activityPayload<F extends ActivityFormParty>(form: F, lead: ActivityLead | null | undefined): F & { leadId: number | null; customerId: number | null } {
  const leadParty = lead?.customerId ?? null;
  return {
    ...form,
    leadId: lead?.id ?? null,
    customerId: leadParty ?? form.customerId ?? null,
  };
}
