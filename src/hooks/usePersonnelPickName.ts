import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { QUERY_KEYS } from '../lib/queryKeys';

interface PersonnelName { fullName?: string | null; firstName?: string | null; lastName?: string | null }

/**
 * TD-1321 (review of v10.2.13): the name of the personnel a saved row points to when the pick list does not hold it (beyond
 * the list's cap, or a personnel who left and is not offered), read from `GET /personnel/:id` only then. The picker shows that
 * person as its chosen option instead of the empty placeholder, so touching the row never drops them; a personnel that can
 * no longer be read gives '' and the caller keeps the name the row stored.
 */
export function usePersonnelPickName(id: number | null | undefined, missing: boolean): string {
  const personnelId = typeof id === 'number' && id > 0 ? id : null;
  const query = useQuery<PersonnelName>({
    queryKey: [...QUERY_KEYS.personnel.all, 'pick-name', personnelId],
    queryFn: ({ signal }) => fetchJson<PersonnelName>(`/personnel/${personnelId}`, { signal }),
    enabled: missing && personnelId !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const person = query.data;
  if (!person) return '';
  return (person.fullName || `${person.firstName || ''} ${person.lastName || ''}`).trim();
}
