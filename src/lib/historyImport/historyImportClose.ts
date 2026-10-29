/**
 * v11 history import, tool 9 (owner's decision 7 Aban 1405): «پایان ورود سابقه». Once the 1405 replay is done the system
 * admin closes the Excel history imports for good: the import windows leave the menus and the server refuses every import
 * call, preview included. One-way: nothing in the app opens them again (a factory reset empties the settings, so a new
 * start can replay again). Kept in `app_settings` under this key, its value the close's day, time and user.
 */

export const HISTORY_IMPORT_CLOSED_KEY = 'history_import_closed';

export const HISTORY_IMPORT_CLOSED = 'HISTORY_IMPORT_CLOSED';

export interface HistoryImportStatus {
  closed: boolean;
  closedAt: string | null;
  closedBy: string | null;
}

export const OPEN_HISTORY_IMPORT: HistoryImportStatus = { closed: false, closedAt: null, closedBy: null };

/** The status a stored value means: any stored value closes the imports, even one that cannot be read. */
export function historyImportStatusOf(value: string | null | undefined): HistoryImportStatus {
  if (value === null || value === undefined) return OPEN_HISTORY_IMPORT;
  try {
    const parsed = JSON.parse(value) as { at?: unknown; by?: unknown };
    return { closed: true, closedAt: typeof parsed.at === 'string' ? parsed.at : null, closedBy: typeof parsed.by === 'string' ? parsed.by : null };
  } catch {
    return { closed: true, closedAt: null, closedBy: null };
  }
}
