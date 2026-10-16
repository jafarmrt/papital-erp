import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';

/**
 * v10.1.37 (N-01, TD-1283): the users a form picks from (`/users/list-simple`: id, user name, full name, role name),
 * never the full user directory; the same cache as the delegation form.
 */
export interface SimpleUser { id: number; username: string; full_name?: string; role_name?: string }

export function useSimpleUsersQuery(enabled = true) {
  return useQuery({
    queryKey: ['users', 'list-simple'],
    queryFn: async () => {
      const body = await fetchJson('/users/list-simple') as { data?: unknown } | unknown[] | null;
      const rows = Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : []);
      return rows as SimpleUser[];
    },
    staleTime: 60000,
    enabled,
  });
}
