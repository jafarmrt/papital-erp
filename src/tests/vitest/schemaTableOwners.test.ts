/**
 * Closing sweep, OBS-R2-19: tables are declared in the schema file of the package that owns them. Red on v10.1.55,
 * where transfers sat in crm.ts, notifications in dailyLogs.ts, form drafts and the WooCommerce order log in
 * documents.ts and idempotency keys in auth.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_DIR = join('src', 'db', 'schema');

const OWNERS: Record<string, string> = {
  transfers: 'inventory.ts',
  notifications: 'notifications.ts',
  form_drafts: 'system.ts',
  idempotency_keys: 'system.ts',
  woocommerce_order_logs: 'woocommerce.ts',
};

function tableFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.ts'))) {
    const text = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const match of text.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) found.set(match[1], file);
  }
  return found;
}

describe('OBS-R2-19 schema table owners', () => {
  it('obs_r2_19_tables_in_owner_files: each listed table is declared in its owner file and the barrel exports that file', () => {
    const files = tableFiles();
    for (const [table, owner] of Object.entries(OWNERS)) expect(`${table} in ${files.get(table)}`).toBe(`${table} in ${owner}`);
    const barrel = readFileSync(join(SCHEMA_DIR, 'index.ts'), 'utf8');
    for (const owner of new Set(Object.values(OWNERS))) expect(barrel).toContain(`export * from './${owner.replace(/\.ts$/, '')}'`);
  });
});
