/**
 * OBS-R2-92: what counts as «a new version of the app was published» and the one automatic reload it earns.
 *
 * Only a failed load of a code chunk is a new version: a dynamic import that could not be fetched or evaluated
 * («Failed to fetch dynamically imported module», Safari's «Importing a module script failed»), webpack-style
 * `ChunkLoadError` and «Loading chunk / CSS chunk … failed». A plain «Failed to fetch» (a request to the API) and
 * «Invalid hook call» (a bug) are ordinary errors.
 *
 * The automatic reload runs at most once per `CHUNK_RELOAD_GUARD_MS` per tab: the time of the last one is kept in
 * sessionStorage. When sessionStorage cannot be read or written (private mode, blocked storage) there is no automatic
 * reload at all, so a broken chunk never reloads the page in a loop; the user still has the reload button.
 */

export const CHUNK_RELOAD_GUARD_MS = 10 * 60 * 1000;
export const CHUNK_RELOAD_STORAGE_KEY = 'erp_chunk_reload_at';

const CHUNK_ERROR_MESSAGES = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (!text) return false;
  if (CHUNK_ERROR_MESSAGES.some(m => text.includes(m))) return true;
  return /loading (css )?chunk [\w-]+ failed/.test(text);
}

/** Records and allows one automatic reload; false when one ran within the guard window or storage is unavailable. */
export function claimChunkReload(now: number = Date.now()): boolean {
  try {
    const storage = window.sessionStorage;
    const last = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY) || '0');
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_GUARD_MS) return false;
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    return storage.getItem(CHUNK_RELOAD_STORAGE_KEY) === String(now);
  } catch {
    return false;
  }
}

export function reloadPage(): void {
  try {
    window.location.reload();
  } catch {
    window.location.href = window.location.href;
  }
}

/** Reloads the page once for a chunk load error; true when a reload was started. */
export function reloadOnceForNewVersion(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  if (!claimChunkReload()) return false;
  reloadPage();
  return true;
}
