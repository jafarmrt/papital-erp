import type { Express, NextFunction, Request, Response } from 'express';
import qs from 'qs';
import { recordMountPaths } from './routeGuardTable.js';

/**
 * v10.1.67 (Express 5): keeps the request shapes the routes were written for under Express 4.
 * - the query string is parsed with qs as Express 4 did (`allowPrototypes`, `arrayLimit` 1000), so `a[b]=1` is still an
 *   object and up to 1000 repeated values stay an array (Express 5's `extended` keeps qs's limit of 20);
 * - `app.use(path, …)` records its mount path on the layer, which the route table reads (`buildRouteGuardTable`).
 */
export function applyExpress4RequestShapes(app: Express): void {
  recordMountPaths(app);
  app.set('query parser', parseExpress4QueryString);
}

export function parseExpress4QueryString(str: string): qs.ParsedQs {
  return qs.parse(str, { allowPrototypes: true, arrayLimit: 1000 });
}

/** Express 5 (body-parser 2) leaves `req.body` undefined when no parser ran; the routes expect the Express 4 `{}`. */
export function emptyBodyDefault(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === undefined) req.body = {};
  next();
}
