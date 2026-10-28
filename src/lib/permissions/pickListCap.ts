/**
 * v11 phase 6.1ch (C13): a form reads at most `PICK_LIST_LIMIT` parties or items of a pick list, never the whole table
 * (5,000 parties were 1.2 MB and 3,000 items 0.9 MB on each form opening). It asks one row more, so it knows when the server
 * had more than the cap. A picker over a list that reached the cap also searches on the server (`pickListServerSearchUrl`,
 * the `serverSearchUrl` of SearchableSelect), and a form that needs the row of a chosen or stored party or item the list
 * lacks reads it by id (`?ids=`, `pickListIdsUrl`). A list under the cap holds every row, so its forms work as before and
 * ask the server nothing more. The same pattern as the personnel pick list (TD-1321, TD-1362).
 */

export const PICK_LIST_LIMIT = 1000;
/** The cap and the one row that says the server had more */
export const PICK_LIST_REQUEST_LIMIT = PICK_LIST_LIMIT + 1;
/** The most ids one `?ids=` read takes */
export const PICK_LIST_IDS_MAX = 200;

function withParams(url: string, edit: (params: URLSearchParams) => void): string {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  edit(params);
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

/** The pick list url (with its own filters, such as `partyType` or `type`) asking at most the cap and one row */
export function cappedPickListUrl(url: string): string {
  return withParams(url, params => params.set('limit', String(PICK_LIST_REQUEST_LIMIT)));
}

/** The rows a form keeps: at most the cap */
export function takePickList<T>(rows: readonly T[]): T[] {
  return rows.slice(0, PICK_LIST_LIMIT);
}

/**
 * Whether a pick list may lack rows: it reached the cap (it was cut, or the server held exactly that many, which only
 * costs a request). Ask it of the whole list a form read, never of a part filtered in the browser (the suppliers of a
 * party list), which can be short while the list it came from was cut.
 */
export function isCutPickList(list: readonly unknown[]): boolean {
  return list.length >= PICK_LIST_LIMIT;
}

/** The server search of a picker over `list`: `url` when the list may lack rows, else none (the picker searches the list) */
export function pickListServerSearchUrl(list: readonly unknown[], url: string): string | undefined {
  return isCutPickList(list) ? url : undefined;
}

/** The ids worth a read by id: whole numbers above zero, each once, in order */
export function pickListIds(ids: readonly unknown[]): number[] {
  const wanted = new Set<number>();
  for (const id of ids) {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0) wanted.add(n);
  }
  return [...wanted].sort((a, b) => a - b).slice(0, PICK_LIST_IDS_MAX);
}

/** The rows of these ids from the pick list `url` (its filters dropped: a stored party or item is read whatever its kind) */
export function pickListIdsUrl(url: string, ids: readonly number[]): string {
  const [path] = url.split('?');
  return `${path}?ids=${pickListIds(ids).join(',')}`;
}

/** `?ids=` as the routes validate it: digits and commas, at most `PICK_LIST_IDS_MAX` ids of a PostgreSQL integer each */
export const PICK_LIST_IDS_PATTERN = new RegExp(`^[1-9]\\d{0,9}(,[1-9]\\d{0,9}){0,${PICK_LIST_IDS_MAX - 1}}$`);
