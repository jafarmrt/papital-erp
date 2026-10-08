import { describe, expect, it } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
import {
  DATA_EXPORT_ACTIVITY_LOG_TABLE, DATA_EXPORT_EXCLUDED_TABLES, DATA_EXPORT_TABLES, dataExportGroupLabels,
} from '../../lib/system/dataExportTables';
import { DATA_EXPORT_TABLE_SOURCES } from '../../services/system/dataExportSources';

// v9.0.387 (TD-624, B01-44, decision t7 a): every Drizzle table is either exported, the optional audit log, or left out
// with a reason, so a new table is classified in the same change; the server reads exactly the listed tables.

const schemaTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map(table => getTableName(table));

describe('data export table list (TD-624)', () => {
  it('classifies every schema table exactly once', () => {
    const exported = DATA_EXPORT_TABLES.map(t => t.table);
    const excluded = Object.keys(DATA_EXPORT_EXCLUDED_TABLES);
    const classified = [...exported, DATA_EXPORT_ACTIVITY_LOG_TABLE, ...excluded];
    expect(schemaTables.filter(t => !classified.includes(t))).toEqual([]);
    expect(classified.filter(t => !schemaTables.includes(t))).toEqual([]);
    expect(classified.filter((t, i) => classified.indexOf(t) !== i)).toEqual([]);
  });

  it('reads exactly the listed tables, each from its own Drizzle table', () => {
    const listed = DATA_EXPORT_TABLES.map(t => t.table).sort();
    expect(Object.keys(DATA_EXPORT_TABLE_SOURCES).sort()).toEqual(listed);
    for (const [name, source] of Object.entries(DATA_EXPORT_TABLE_SOURCES)) {
      expect(getTableName(source.table), name).toBe(name);
    }
  });

  it('exports the tables the settings card promises', () => {
    const exported = DATA_EXPORT_TABLES.map(t => t.table);
    for (const table of [
      'project_bom_allocations', 'project_product_stage_progress', 'pending_materials', 'piecework_tasks',
      'piecework_personnel_rates', 'piecework_task_rate_history', 'task_categories', 'fiscal_periods', 'file_attachments',
      'workflow_definitions', 'workflow_instances', 'workflow_history_logs', 'event_action_rules',
    ]) expect(exported, table).toContain(table);
    expect(dataExportGroupLabels().join(' ')).toMatch(/پروژه‌ها.*کارمزدی.*گردش کار/s);
  });

  it('never exports credentials or signing secrets', () => {
    const userColumns = Object.keys(DATA_EXPORT_TABLE_SOURCES.users.columns ?? {});
    expect(userColumns).not.toContain('password');
    expect(userColumns).not.toContain('tokenVersion');
    expect(Object.keys(DATA_EXPORT_TABLE_SOURCES.personnel.columns ?? {})).not.toContain('nobitexPassword');
    expect(DATA_EXPORT_TABLES.map(t => t.table)).not.toContain('webhook_subscriptions');
  });
});
