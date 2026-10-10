/**
 * v10.0.87 (TD-1191): a settings form action waits on its mutation through this helper. The mutation's own `onError`
 * already shows the Persian message, so a refused save only answers false and the form stays open; the rejection never
 * leaves the submit handler. Before, `await mutateAsync(...)` in an async form handler rethrew it, and every refused
 * warehouse or category save also logged an uncaught page error in the console.
 */
export async function mutationSucceeded(pending: Promise<unknown>): Promise<boolean> {
  try {
    await pending;
    return true;
  } catch {
    return false;
  }
}
