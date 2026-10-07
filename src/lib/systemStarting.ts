/**
 * v9.0.148 (TD-584, product-owner decision ت۲): while the server finishes an update (migrations, seed) every
 * `/api` request answers 503 with code `SYSTEM_STARTING` and `Retry-After`. The browser does not show this as
 * an error: `fetchThroughStartup` waits and sends the same request again (the server ran nothing for it), and
 * `SystemStartingOverlay` shows a waiting page in the meantime.
 */
export const SYSTEM_STARTING_CODE = 'SYSTEM_STARTING';
/** At 5 seconds per wait, about ten minutes: as long as update.sh waits for startup */
export const SYSTEM_STARTING_MAX_WAITS = 120;

type Listener = (starting: boolean) => void;
const listeners = new Set<Listener>();
let starting = false;

export function isSystemStarting(): boolean {
  return starting;
}

export function subscribeSystemStarting(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setStarting(next: boolean): void {
  if (starting === next) return;
  starting = next;
  listeners.forEach(listener => listener(next));
}

export function systemStartingDelayMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : 5000;
}

async function isStartingResponse(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const body = await res.clone().json() as { code?: unknown };
    return body?.code === SYSTEM_STARTING_CODE;
  } catch {
    return false;
  }
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => { const err = new Error('The operation was aborted.'); err.name = 'AbortError'; return err; };
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Sends the request, and while the server answers «starting» waits `Retry-After` and sends it again, at most
 * `SYSTEM_STARTING_MAX_WAITS` times; the last «starting» answer is returned as is (shown as an error).
 */
export async function fetchThroughStartup(send: () => Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  for (let waits = 0; ; waits++) {
    const res = await send();
    if (waits >= SYSTEM_STARTING_MAX_WAITS || !(await isStartingResponse(res))) {
      setStarting(false);
      return res;
    }
    setStarting(true);
    try {
      await wait(systemStartingDelayMs(res.headers.get('Retry-After')), signal);
    } catch (err) {
      setStarting(false);
      throw err;
    }
  }
}

/** Test helper: back to «not starting» without notifying */
export function resetSystemStarting(): void {
  starting = false;
}
