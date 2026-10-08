import { describe, expect, it } from 'vitest';
import { DATABASE_NOT_CONFIGURED, DEMO_MODE_REFUSED_IN_PRODUCTION, resolveDatabaseMode } from '../../db/databaseMode';

// v9.0.397 (TD-616, B01-36, decision t4 «الف»): SQL_HOST, then a real DATABASE_URL, then the in-memory demo database only
// with ERP_DEMO_MODE=1 outside production; anything else is refused. Never an automatic fallback to the demo database.

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

  it('starts the demo database only with ERP_DEMO_MODE=1 outside production', () => {
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1', NODE_ENV: 'development' }).kind).toBe('demo');
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1' }).kind).toBe('demo');
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: 'true', NODE_ENV: 'development' }).kind).toBe('refused');
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1', NODE_ENV: 'production' })).toEqual({ kind: 'refused', reason: DEMO_MODE_REFUSED_IN_PRODUCTION });
    expect(resolveDatabaseMode({ ERP_DEMO_MODE: '1', DATABASE_URL: 'postgresql://u:p@db:5432/erp' }).kind).toBe('url');
  });
});
