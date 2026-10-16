import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
import { FACTORY_RESET_KEPT_TABLES, FACTORY_RESET_WIPE_ORDER } from '../../services/system/factoryResetTables';

// v10.1.45 closing sweep: OBS-R1-12 (the factory reset wipes every table, in foreign-key order) and
// OBS-R1-11 (the reset takes no options and clears the session cookie once the wipe has committed).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const schemaTables = (Object.values(schema) as unknown[]).filter((t): t is PgTable => is(t, PgTable));
const wipedNames = FACTORY_RESET_WIPE_ORDER.map(w => w.name);

describe('OBS-R1-12: the factory reset classifies every schema table', () => {
  it('names each wiped table by its own table name, once', () => {
    for (const { name, table } of FACTORY_RESET_WIPE_ORDER) expect(getTableName(table)).toBe(name);
    expect(new Set(wipedNames).size).toBe(wipedNames.length);
  });

  it('wipes or keeps every table of the schema, never both', () => {
    const kept = Object.keys(FACTORY_RESET_KEPT_TABLES);
    const all = schemaTables.map(t => getTableName(t)).sort();
    expect([...wipedNames, ...kept].sort()).toEqual(all);
    expect(kept.filter(k => wipedNames.includes(k))).toEqual([]);
  });

  it('deletes a row before every row it references, unless the reference cascades', () => {
    const position = new Map(wipedNames.map((n, i) => [n, i]));
    const wrong: string[] = [];
    for (const table of schemaTables) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        if (fk.onDelete === 'cascade' || fk.onDelete === 'set null') continue;
        const parent = getTableName(fk.reference().foreignTable);
        if (parent === config.name) continue;
        const child = position.get(config.name);
        const parentAt = position.get(parent);
        if (parentAt === undefined) continue;
        if (child === undefined) wrong.push(`${config.name} is kept but references wiped ${parent}`);
        else if (child > parentAt) wrong.push(`${config.name} is wiped after ${parent}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('includes the tables the reset used to leave behind', () => {
    for (const name of ['item_code_history', 'statutory_remittance_lines', 'user_messenger_links', 'messenger_bots', 'media_assets', 'integration_delivery_jobs']) {
      expect(wipedNames).toContain(name);
    }
    expect(read('src/services/system/factoryReset.service.ts')).toContain('FACTORY_RESET_WIPE_ORDER');
  });
});

describe('OBS-R1-11: the reset body and the session cookie', () => {
  it('accepts only an empty body and the settings page sends one', () => {
    const routes = read('src/routes/system.routes.ts');
    const at = routes.indexOf('const clearDataSchema');
    expect(routes.slice(at, at + 200)).toContain('z.object({}).strict()');
    expect(routes).not.toMatch(/mode:\s*z\.string\(\)\.optional\(\)/);
    expect(read('src/hooks/useSettings.ts')).not.toContain("mode: 'all'");
  });

  it('clears the cookie when the wipe committed but the seed failed', () => {
    const routes = read('src/routes/system.routes.ts');
    expect(routes).toMatch(/if \(isFactoryResetCommittedError\(err\)\) res\.clearCookie\(AUTH_COOKIE_NAME/);
  });
});
