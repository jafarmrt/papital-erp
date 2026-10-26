import pkg from 'pg';
import { timestamptzTextAsUtc } from '../lib/serverTimestamp.js';

type QueryTypes = { getTypeParser: (oid: number, format?: string) => unknown };
const TIMESTAMPTZ_OID = pkg.types.builtins.TIMESTAMPTZ;

/**
 * v11 (phase 4.2): Drizzle reads timestamps as PostgreSQL's own text (its `types` override on every query). The server
 * timestamps are timestamptz now, whose text carries `+00`; this keeps the text the app has always had, the UTC time
 * without an offset (`timestamptzTextAsUtc`). Queries without Drizzle's override (`pool.query`) still get a Date.
 */
export function withUtcTimestamptzText<C>(config: C): C {
  if (!config || typeof config !== 'object' || 'submit' in config) return config;
  const types = (config as { types?: QueryTypes }).types;
  if (!types || typeof types.getTypeParser !== 'function') return config;
  const getTypeParser: QueryTypes['getTypeParser'] = (oid, format) => {
    const parse = types.getTypeParser(oid, format);
    if (oid !== TIMESTAMPTZ_OID || typeof parse !== 'function') return parse;
    return (value: string) => {
      const parsed: unknown = parse(value);
      return typeof parsed === 'string' ? timestamptzTextAsUtc(parsed) : parsed;
    };
  };
  return { ...config, types: { ...types, getTypeParser } };
}

/** The pool's client: every query goes through `withUtcTimestamptzText` (pg's overloaded query() is passed through) */
export class ServerTimestampClient extends pkg.Client {
  constructor(config?: string | pkg.ClientConfig) {
    super(config);
    const query = this.query.bind(this) as (...args: unknown[]) => unknown;
    Object.assign(this, { query: (config: unknown, ...rest: unknown[]) => query(withUtcTimestamptzText(config), ...rest) });
  }
}
