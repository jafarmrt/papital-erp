/**
 * v10.1.31 (TD-1279): pins every client checked out of the pool to the isolated test schema.
 *
 * The test bootstrap used to send `SET search_path` from the pool's 'acquire' event without waiting,
 * so the caller's own query ran on the same client while the SET was still running. pg 8 queues that
 * with a DeprecationWarning; pg 9 removes the queue. Here the pool's `connect` waits for the SET before
 * it hands the client on; `pool.query` and Drizzle transactions both check out through `connect`.
 */

export interface SearchPathClient {
  query: (text: string) => Promise<unknown>;
  release: (err?: Error | boolean) => void;
}

type ConnectCallback<C> = (err: Error | undefined, client?: C, release?: (err?: Error | boolean) => void) => void;

export interface SearchPathPool<C extends SearchPathClient> {
  connect: {
    (): Promise<C>;
    (cb: ConnectCallback<C>): void;
  };
}

export function searchPathStatement(schema: string): string {
  return `SET search_path TO "${schema}", public`;
}

/** Wraps `pool.connect`; the returned function puts the previous `connect` back. */
export function pinSearchPathOnCheckout<C extends SearchPathClient>(pool: SearchPathPool<C>, schema: string): () => void {
  const target = pool as unknown as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'connect');
  const previousOwn = target.connect;
  const original = (pool.connect as () => Promise<C>).bind(pool);
  const statement = searchPathStatement(schema);

  const checkout = async (): Promise<C> => {
    const client = await original();
    try {
      await client.query(statement);
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
    return client;
  };

  target.connect = (cb?: ConnectCallback<C>) => {
    const pending = checkout();
    if (!cb) return pending;
    pending.then(
      (client) => cb(undefined, client, client.release.bind(client)),
      (err: unknown) => cb(err instanceof Error ? err : new Error(String(err))),
    );
    return undefined;
  };

  return () => {
    if (hadOwn) target.connect = previousOwn;
    else delete target.connect;
  };
}
