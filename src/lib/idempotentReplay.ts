/**
 * v10.2.34 (#351 review L1): the answer a repeat of a payroll or piecework request gets. Since v10.2.33 (TD-1328) the
 * server keeps no answer with those keys (they carry names and amounts), so a resend of a request that already ran, for
 * example after its first answer was lost on the network, gets only this notice: it has no payslip number, voucher or log
 * ids. A screen that reads such a field shows the notice and reloads its list instead.
 */
export const IDEMPOTENT_REPLAY_MESSAGE = 'این درخواست پیش‌تر ثبت شده است؛ نتیجهٔ آن را در فهرست ببینید.';

/** The answer while another run of the same key is in progress (409 `IDEMPOTENCY_IN_FLIGHT`); a later resend gets the notice above */
export const IDEMPOTENCY_IN_FLIGHT_MESSAGE = 'درخواست تکراری در حال پردازش است. لطفاً چند لحظه دیگر دوباره تلاش کنید.';

export interface IdempotentReplayBody {
  success: true;
  idempotentReplay: true;
  message: string;
}

/** Whether an answer is the repeat notice above rather than the request's own answer */
export function isIdempotentReplay(res: unknown): res is IdempotentReplayBody {
  return typeof res === 'object' && res !== null && (res as { idempotentReplay?: unknown }).idempotentReplay === true;
}

/** The text to show for a repeat notice: the server's own, else the shared one */
export function idempotentReplayMessage(res: IdempotentReplayBody): string {
  return typeof res.message === 'string' && res.message.trim() ? res.message : IDEMPOTENT_REPLAY_MESSAGE;
}
