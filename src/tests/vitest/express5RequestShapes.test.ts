// @vitest-environment node
/**
 * v10.1.67 (Express 5): the routes keep the request shapes they were written for under Express 4. A nested query
 * string is still an object, a request without a body still has `req.body = {}`, `validate` replaces the query with
 * the parsed one (Express 5 makes `req.query` a getter), a rejected async handler reaches the error handler without
 * express-async-errors, the route table still reads the mount paths, and the app's catch-all uses the Express 5 path
 * syntax.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { applyExpress4RequestShapes, emptyBodyDefault } from '../../lib/express5Compat';
import { buildRouteGuardTable } from '../../lib/routeGuardTable';
import { validate } from '../../middleware/validate';

function app() {
  const server = express();
  applyExpress4RequestShapes(server);
  server.use(express.json());
  server.use(emptyBodyDefault);
  const router = express.Router();
  router.get('/query', (req, res) => { res.json({ query: req.query }); });
  router.post('/body', (req, res) => { res.json({ body: req.body ?? null }); });
  router.get('/limit', validate(z.object({ query: z.object({ limit: z.coerce.number() }) })), (req, res) => {
    res.json({ limit: req.query.limit, type: typeof req.query.limit });
  });
  router.get('/boom', async () => { throw new Error('boom'); });
  server.use('/api/x', router);
  server.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  return server;
}

describe('Express 5 request shapes', () => {
  it('parses a nested query string into an object', async () => {
    const res = await request(app()).get('/api/x/query?filter[status]=open&ids=1&ids=2');
    expect(res.body.query).toEqual({ filter: { status: 'open' }, ids: ['1', '2'] });
  });

  it('gives a request without a body an empty object', async () => {
    const res = await request(app()).post('/api/x/body');
    expect(res.body.body).toEqual({});
  });

  it('lets validate replace the query with the parsed values', async () => {
    const res = await request(app()).get('/api/x/limit?limit=25');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ limit: 25, type: 'number' });
  });

  it('sends a rejected async handler to the error handler', async () => {
    const res = await request(app()).get('/api/x/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });

  it('builds the route table with the mount path', () => {
    const paths = buildRouteGuardTable(app()).map(row => `${row.method} ${row.path}`);
    expect(paths).toEqual(expect.arrayContaining(['GET /api/x/query', 'POST /api/x/body', 'GET /api/x/limit']));
  });

  it('uses the Express 5 catch-all path for the built app', () => {
    const server = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    expect(server).not.toContain("app.get('*'");
    expect(server).toContain("app.get('/{*splat}'");
  });
});
