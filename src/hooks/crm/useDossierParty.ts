import { useQueryClient } from '@tanstack/react-query';
import type { Customer } from '../../types';
import { isCutPickList } from '../../lib/permissions/pickListCap';
import { resolveDossierParty } from '../../lib/crm/crmDeepLink';
import { fetchPickMatches, fetchPickRows, withPickRows } from '../queries/usePickListRows';

/** How many of the server's matches for a file's party name are read to find the only party of that very name */
const DOSSIER_NAME_MATCHES = 50;

/**
 * v11 phase 6.1ch (C13): the party whose dossier a sales file or a link opens (`resolveDossierParty`). The sales page's
 * party list holds at most the cap; when it reached the cap, a party it lacks is read by id, or (a file with a name only)
 * found among the server's matches for the name, under the same rule: the only party of exactly that name.
 */
export function useDossierPartyFinder(parties: readonly Customer[]) {
  const queryClient = useQueryClient();
  return async (lead: { customerId?: number | null; customerName?: string | null }): Promise<Customer | null> => {
    const listed = resolveDossierParty(lead, parties);
    const id = Number(lead.customerId);
    const byId = Number.isSafeInteger(id) && id > 0;
    if (!isCutPickList(parties) || (byId && listed)) return listed;
    if (byId) return (await fetchPickRows<Customer>(queryClient, 'customers', [id]))[0] ?? null;
    // by name, the server decides even when the cut list holds one party of the name: it may hold another past the cap
    const matches = await fetchPickMatches<Customer>(queryClient, 'customers', String(lead.customerName ?? ''), DOSSIER_NAME_MATCHES);
    return resolveDossierParty(lead, withPickRows(parties, matches));
  };
}
