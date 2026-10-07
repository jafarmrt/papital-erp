import { can } from '../../middleware/authorize.js';

/**
 * v9.0.213 (TD-626, decision ت۱ الف): who manages every daily work log (sees private ones, reviews, edits and deletes
 * another user's log) is decided only by the permission `daily_logs.manage_all` (the system admin holds every key),
 * never by a role code such as `manager`.
 */
export async function canManageAllDailyLogs(user: { role?: string } | undefined): Promise<boolean> {
  return can(user, 'daily_logs.manage_all');
}
