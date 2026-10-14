/**
 * Vitest setup for every test file (vitest.config.ts `setupFiles`).
 *
 * Testing Library waits 1 s by default in `findBy*` and `waitFor`; on a loaded two-core CI runner a lazy page can still
 * show its loading state after that (accountingQueryCache: the accounting page was still loading at 1,056 ms). Every
 * async query and `waitFor` therefore waits up to 5 s unless the test passes its own timeout. Files that run in the node
 * environment have no DOM and do not load Testing Library.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 5_000;

if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });
}
