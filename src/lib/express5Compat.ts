import type { Express, NextFunction, Request, Response } from 'express';
import { recordMountPaths } from './routeGuardTable.js';

/**
 * v10.1.67 (Express 5): keeps the request shapes the routes were written for under Express 4.
 * - the query string is parsed with `extended` (qs), so `a[b]=1` is still an object (Express 5 defaults to `simple`);
 * - `app.use(path, …)` records its mount path on the layer, which the route table reads (`buildRouteGuardTable`).
 */
export function applyExpress4RequestShapes(app: Express): void {
  recordMountPaths(app);
  app.set('query parser', 'extended');
}

/** Express 5 (body-parser 2) leaves `req.body` undefined when no parser ran; the routes expect the Express 4 `{}`. */
export function emptyBodyDefault(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === undefined) req.body = {};
  next();
}
