/**
 * The retry rule of every query (`queryClient`). A sign-in or permission refusal, and since v11 phase 6.3b (U20) any other
 * client error (4xx: a missing record, a rule such as «حساب شما به پرونده پرسنلی وصل نیست»), answers the same on every
 * try, so it is shown at once instead of after three more tries; a server or network failure is tried up to three times.
 * A timeout (408) and «too many requests» (429) may pass on a later try.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const err = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown } | null | undefined;
  const status = Number(err?.status ?? err?.statusCode);
  const message = typeof err?.message === 'string' ? err.message : '';
  if (err?.code === 'UNAUTHORIZED' || err?.code === 'FORBIDDEN' || message.includes('401') || message.includes('403') || message.includes('غیرمجاز')) {
    return false;
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return failureCount < 3;
}
