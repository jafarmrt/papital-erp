import { describe, expect, it } from 'vitest';
import { DATABASE_NOT_CONFIGURED, DEMO_MODE_REMOVED, resolveDatabaseMode } from '../../db/databaseMode';

// v9.0.428 (TD-616, B01-36, decision t4 «الف»): SQL_HOST, then a real DATABASE_URL; anything else is refused.
// v11 (phase 4.1): the in-memory demo database was removed, so ERP_DEMO_MODE=1 starts nothing and says why.

describe('database mode (TD-616)', () => {
  it('uses SQL_HOST without DATABASE_URL', () => {
    expect(resolveDatabaseMode({ SQL_HOST: 'db.internal' }).kind).toBe('sql_host');
    expect(resolveDatabaseMode({ SQL_HOST: 'db.internal', DATABASE_URL: 'postgresql://u:p@db:5432/erp' }).kind).toBe('sql_host');
  });

  it('uses a real DATABASE_URL', () => {
    expect(resolveDatabaseMode({ DATABASE_URL: ' postgresql://u:p@db:5432/erp ' })).toEqual({ kind: 'url', url: 'postgresql://u:p@db:5432/erp' });
  });

  it('refuses a missing or example DATABASE_URL in every environment', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      expect(resolveDatabaseMode({ NODE_ENV })).toEqual({ kind: 'refused', reason: DATABASE_NOT_CONFIGURED });
      expect(resolveDatabaseMode({ NODE_ENV, DATABASE_URL: 'postgresql://user:password@host:5432/dbname' }).kind).toBe('refused');
      expect(resolveDatabaseMode({ NODE_ENV, SQL_HOST: '  ' }).kind).toBe('refused');
    }
  });

  it('refuses a leftover ERP_DEMO_MODE=1 without a database in every environment, naming the removal', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1', NODE_ENV })).toEqual({ kind: 'refused', reason: DEMO_MODE_REMOVED });
    }
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: 'true', NODE_ENV: 'development' })).toEqual({ kind: 'refused', reason: DATABASE_NOT_CONFIGURED });
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1', DATABASE_URL: 'postgresql://u:p@db:5432/erp' }).kind).toBe('url');
  });
});
