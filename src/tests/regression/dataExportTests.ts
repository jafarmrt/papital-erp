import request from 'supertest';
import { PassThrough } from 'stream';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 1 finding B01-12, TD-592 (decision t7 a): the data export was one unbounded `SELECT *` per table answered
 * with one `res.json` (950,000 audit rows: 750 MiB, 3 GiB of process memory, `/health/live` waited 13 s). Now it is a
 * streamed zip with one NDJSON file per table, read in key-ordered batches, and the audit log comes only on request
 * for a date range. On v9.0.385 the route answered `application/json` named `.json` with `activityLogs` always inside.
 */
export async function runDataExportTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  return [...await runStreamedZipTest(shouldRun), ...await runDataExportCoverageTest(shouldRun)];
}

async function runStreamedZipTest(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_data_export_streamed_zip_td_592';
  if (!shouldRun(id, 'td592', 'b01-12', 'export', 'package1')) return results;

  const name = 'v9.0.386: data export is a streamed zip of NDJSON tables read in batches; audit log only for a date range (TD-592)';
  const tStart = Date.now();
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { readZipEntries, ndjsonRows, binaryParser } = await import('../fixtures/zipReader.js');
    const { DataExportService } = await import('../../services/system/dataExport.service.js');
    const { pool } = await import('../../db/drizzle.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    const today = await businessTodayIsoDate();
    const marker = `td592_${Date.now().toString(36)}`;

    // five audit rows today and one 400 days ago, all with the marker
    await pool.query(
      `INSERT INTO activity_logs (username, action, entity, description, timestamp)
       SELECT 'td592', 'UPDATE', 'کالا', $1 || ':' || g, now() - CASE WHEN g = 6 THEN interval '400 days' ELSE interval '0' END
         FROM generate_series(1, 6) g`, [marker]);
    try {
      const get = (url: string) => request(app).get(url).set('Cookie', admin.cookie).buffer(true).parse(binaryParser as never);

      const plain = await get('/api/export-backup');
      const type = String(plain.headers['content-type'] || '');
      const disposition = String(plain.headers['content-disposition'] || '');
      if (plain.status !== 200 || !type.startsWith('application/zip') || !disposition.endsWith('.zip"')) {
        throw new Error(`export answered ${plain.status} ${type} ${disposition} (expected a zip download)`);
      }
      const entries = readZipEntries(plain.body as Buffer);
      const manifest = JSON.parse(entries.get('manifest.json')?.toString('utf8') || '{}') as {
        format?: string; activityLogs?: { included: boolean }; tables?: Array<{ name: string; file: string; rows: number }>;
      };
      if (manifest.format !== 'papital-erp/data-export@3') wrong.push(`manifest format ${manifest.format}`);
      if (manifest.activityLogs?.included !== false || entries.has('activity_logs.ndjson')) wrong.push('audit log exported without being asked');
      for (const t of manifest.tables || []) {
        const rows = ndjsonRows(entries.get(t.file));
        if (rows.length !== t.rows) wrong.push(`${t.file}: ${rows.length} rows, manifest says ${t.rows}`);
      }
      if (!(manifest.tables || []).some(t => t.name === 'journal_voucher_items')) wrong.push('journal_voucher_items missing');
      const users = ndjsonRows(entries.get('users.ndjson'));
      if (users.length === 0 || users.some(u => 'password' in u || 'tokenVersion' in u)) wrong.push('users rows missing or with credentials');

      // audit log of today only, read two rows per query: every marked row of the range, in id order
      const out = new PassThrough();
      const chunks: Buffer[] = [];
      out.on('data', (c: Buffer) => chunks.push(c));
      const small = await DataExportService.writeExport(out, { activityLogs: { from: today, to: today }, batchSize: 2 });
      const smallEntries = readZipEntries(Buffer.concat(chunks));
      const marked = ndjsonRows(smallEntries.get('activity_logs.ndjson')).filter(r => String(r.description).startsWith(marker));
      const ids = marked.map(r => Number(r.id));
      if (marked.length !== 5) wrong.push(`audit rows of today with batches of 2: ${marked.length} (expected 5, the 400-day-old row excluded)`);
      if (ids.some((v, i) => i > 0 && v <= ids[i - 1])) wrong.push(`audit rows not in id order: ${ids.join(',')}`);
      for (const t of small.tables) {
        const rows = ndjsonRows(smallEntries.get(t.file));
        if (rows.length !== t.rows) wrong.push(`batched ${t.file}: ${rows.length} rows, manifest says ${t.rows}`);
      }
      const settings = ndjsonRows(smallEntries.get('app_settings.ndjson'));
      if (settings.some(r => /secret|token|password|api_key|consumer/i.test(String(r.key)))) wrong.push('a secret setting was exported');

      const withRange = await get(`/api/export-backup?activityLogs=1&from=${today}&to=${today}`);
      if (withRange.status !== 200 || !readZipEntries(withRange.body as Buffer).has('activity_logs.ndjson')) {
        wrong.push(`export with audit log range answered ${withRange.status} without activity_logs.ndjson`);
      }
      const noRange = await request(app).get('/api/export-backup?activityLogs=1').set('Cookie', admin.cookie);
      if (noRange.status !== 400) wrong.push(`audit log without a range answered ${noRange.status} (expected 400)`);
      const reversed = await request(app).get(`/api/export-backup?activityLogs=1&from=${today}&to=2000-01-01`).set('Cookie', admin.cookie);
      if (reversed.status !== 400) wrong.push(`audit log with end before start answered ${reversed.status} (expected 400)`);

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: `zip with ${manifest.tables?.length} NDJSON tables and a manifest; audit log only with a range (5 of 6 rows, batches of 2)`,
      }));
    } finally {
      await pool.query(`DELETE FROM activity_logs WHERE description LIKE $1`, [`${marker}:%`]);
    }
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
  return results;
}

/**
 * Package 1 finding B01-44, TD-624 (decision t7 a): the export missed tables the settings card promised (project
 * allocations, piecework tasks and rates, fiscal periods, attachment metadata, workflow, event rules), so work logs
 * pointed at tasks without a name or rate. On v9.0.386 the manifest had none of them.
 */
async function runDataExportCoverageTest(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const id = 'reg_data_export_table_coverage_td_624';
  if (!shouldRun(id, 'td624', 'b01-44', 'export', 'package1')) return [];
  const name = 'v9.0.387: data export holds project, piecework, fiscal period, workflow, event rule and attachment tables (TD-624)';
  const tStart = Date.now();
  try {
    const { readZipEntries, ndjsonRows } = await import('../fixtures/zipReader.js');
    const { DataExportService } = await import('../../services/system/dataExport.service.js');
    const { createTestItem, createTestVoucher } = await import('../fixtures/factories.js');
    const { pool } = await import('../../db/drizzle.js');
    const wrong: string[] = [];
    const tag = Date.now().toString(36);

    // three opening rows of one voucher: a composite key (voucher_id, item_id) read two rows per query
    const { voucher } = await createTestVoucher({ description: `td624 ${tag}` });
    const itemIds: number[] = [];
    for (let i = 0; i < 3; i++) itemIds.push((await createTestItem({ code: `TD624-${tag}-${i}` })).id);
    for (const itemId of itemIds) {
      await pool.query(`INSERT INTO item_opening_voucher_items (voucher_id, item_id, amount) VALUES ($1, $2, 1000)`, [voucher.id, itemId]);
    }
    await pool.query(`INSERT INTO task_categories (name) VALUES ($1)`, [`td624 ${tag}`]);
    const period = await pool.query(`INSERT INTO fiscal_periods (fiscal_year, status) VALUES (1391, 'open') ON CONFLICT DO NOTHING RETURNING fiscal_year`);

    const { PassThrough } = await import('stream');
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    const manifest = await DataExportService.writeExport(out, { batchSize: 2 });
    const entries = readZipEntries(Buffer.concat(chunks));

    const names = manifest.tables.map(t => t.name);
    for (const table of [
      'project_bom_allocations', 'project_product_stage_progress', 'pending_materials', 'piecework_tasks',
      'piecework_personnel_rates', 'piecework_task_rate_history', 'task_categories', 'fiscal_periods', 'file_attachments',
      'workflow_definitions', 'workflow_states', 'workflow_transitions', 'workflow_instances', 'event_action_rules',
    ]) {
      if (!names.includes(table) || !entries.has(`${table}.ndjson`)) wrong.push(`${table} missing`);
    }
    const opening = ndjsonRows(entries.get('item_opening_voucher_items.ndjson')).filter(r => Number(r.voucherId) === voucher.id);
    if (opening.length !== 3) wrong.push(`opening rows of the voucher with batches of 2: ${opening.length} (expected 3)`);
    if (!ndjsonRows(entries.get('task_categories.ndjson')).some(r => r.name === `td624 ${tag}`)) wrong.push('task category missing');
    if (!ndjsonRows(entries.get('fiscal_periods.ndjson')).some(r => Number(r.fiscalYear) === 1391)) wrong.push('fiscal period 1391 missing');
    if (!manifest.excludedTables?.webhook_subscriptions) wrong.push('manifest does not list the left-out tables');

    await pool.query(`DELETE FROM item_opening_voucher_items WHERE voucher_id = $1`, [voucher.id]);
    await pool.query(`DELETE FROM task_categories WHERE name = $1`, [`td624 ${tag}`]);
    if (period.rowCount) await pool.query(`DELETE FROM fiscal_periods WHERE fiscal_year = 1391`);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `${manifest.tables.length} tables; composite-key rows read across batches; left-out tables listed with a reason`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  }
}
