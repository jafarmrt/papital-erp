import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pinSearchPathOnCheckout, searchPathStatement, type SearchPathPool } from '../setup/schemaSearchPath';

// TD-1279: pg 9 drops the per-client query queue, so the test bootstrap must never start a query on a
// client that is still running its search_path SET.

class FakeClient {
  inFlight = 0;
  overlaps = 0;
  log: string[] = [];
  released = 0;
  query(text: string): Promise<unknown> {
    if (this.inFlight > 0) this.overlaps += 1;
    this.inFlight += 1;
    this.log.push(text);
    return new Promise((resolve) => setTimeout(() => { this.inFlight -= 1; resolve({ rows: [] }); }, 5));
  }
  release(): void { this.released += 1; }
}

/** Mirrors pg-pool: `query` checks out through `this.connect(cb)`, and 'acquire' fires before the callback. */
class FakePool {
  client = new FakeClient();
  acquireHandlers: Array<(c: FakeClient) => void> = [];
  on(event: string, fn: (c: FakeClient) => void) { if (event === 'acquire') this.acquireHandlers.push(fn); }
  connect(cb?: (err: Error | undefined, c?: FakeClient, release?: () => void) => void): Promise<FakeClient> | void {
    const deliver = () => { this.acquireHandlers.forEach((fn) => fn(this.client)); return this.client; };
    if (cb) { setTimeout(() => { const c = deliver(); cb(undefined, c, c.release.bind(c)); }, 0); return; }
    return new Promise((resolve) => setTimeout(() => resolve(deliver()), 0));
  }
  query(text: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      void this.connect((err, client) => {
        if (err || !client) return reject(err);
        client.query(text).then((r) => { client.release(); resolve(r); }, reject);
      });
    });
  }
}

const pin = (pool: FakePool, schema: string) => pinSearchPathOnCheckout(pool as unknown as SearchPathPool<FakeClient>, schema);

describe('test schema search_path pinning (TD-1279)', () => {
  it('the old acquire handler overlapped two queries on one client', async () => {
    const pool = new FakePool();
    pool.on('acquire', (c) => { void c.query(searchPathStatement('test_1')); });
    await pool.query('SELECT 1');
    expect(pool.client.overlaps).toBe(1);
  });

  it('pool.query runs only after the search_path SET has finished', async () => {
    const pool = new FakePool();
    pin(pool, 'test_1');
    await pool.query('SELECT 1');
    expect(pool.client.overlaps).toBe(0);
    expect(pool.client.log).toEqual(['SET search_path TO "test_1", public', 'SELECT 1']);
  });

  it('a promise checkout (Drizzle transactions) is pinned too, and restore puts connect back', async () => {
    const pool = new FakePool();
    const restore = pin(pool, 'test_2');
    const client = await (pool.connect() as Promise<FakeClient>);
    expect(client.log).toEqual(['SET search_path TO "test_2", public']);
    restore();
    expect(Object.prototype.hasOwnProperty.call(pool, 'connect')).toBe(false);
  });

  it('the bootstrap no longer sends a query from an acquire handler', () => {
    const source = readFileSync('src/tests/setup/testDb.ts', 'utf8');
    expect(source).not.toMatch(/on\('acquire'/);
    expect(source).toMatch(/pinSearchPathOnCheckout\(/);
  });

  it('no server code runs two queries at once on one transaction or executor', () => {
    expect(concurrentExecutorQueries(['src/services', 'src/routes', 'src/lib', 'src/db'])).toEqual([]);
  });
});

/** Names that hold a transaction or a pool client: tx, trx, externalTx, txEngine, executor, txExecutor, db, dbx, client, outer, held; a class name such as WorkflowTransitionExecutor is not one. */
const EXECUTOR_NAME = /\b(?![A-Z])\w*(tx|Tx|[eE]xecutor)\w*\b|\b(trx|db|dbx|client|outer|held)\b/;

/** `Promise.all(...)` / `Promise.allSettled(...)` whose arguments use a transaction or executor (pg 9 refuses the overlap). */
function concurrentExecutorQueries(roots: string[]): string[] {
  const found: string[] = [];
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) { readdirSync(path).forEach((name) => visit(join(path, name))); return; }
    if (!/\.ts$/.test(path)) return;
    const text = readFileSync(path, 'utf8');
    const start = /Promise\.all(Settled)?\(/g;
    for (let m = start.exec(text); m; m = start.exec(text)) {
      let depth = 1;
      let end = m.index + m[0].length;
      while (depth > 0 && end < text.length) { if (text[end] === '(') depth += 1; else if (text[end] === ')') depth -= 1; end += 1; }
      if (EXECUTOR_NAME.test(text.slice(m.index, end))) found.push(`${path}:${text.slice(0, m.index).split('\n').length}`);
    }
  };
  roots.forEach(visit);
  return found;
}
