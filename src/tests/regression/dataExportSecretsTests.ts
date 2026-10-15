import { PassThrough } from 'stream';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Export review of 2026-10-12 (v10.0.274), TD-1251: the data export notice says it holds no secret keys, yet the
 * `event_action_rules` file carried a webhook rule's `actionConfigJson.secretToken` and its header values in clear.
 * The test stores a rule with a token and a header value, exports, and fails when either value appears anywhere in
 * the zip or when any secret-like key at any depth of any exported row holds an unmasked text value.
 */
const SECRET_KEY = /password|secret|token|api[_-]?key|authorization|cookie|jwt|consumer[_-]?key/i;

/** Paths of secret-like keys whose text value is neither empty nor the mask */
function unmaskedSecretPaths(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) { value.forEach((v, i) => unmaskedSecretPaths(v, `${path}[${i}]`, found)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key) && typeof v === 'string' && v !== '' && v !== '********') found.push(`${path}.${key}`);
    unmaskedSecretPaths(v, `${path}.${key}`, found);
  }
}

export async function runDataExportSecretsTest(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const id = 'reg_data_export_no_secrets_td_1251';
  if (!shouldRun(id, 'td1251', 'export', 'secret')) return [];
  const name = 'v10.1.5: data export masks webhook rule tokens, header values and every secret-like field (TD-1251)';
  const tStart = Date.now();
  const { pool } = await import('../../db/drizzle.js');
  const tag = `td1251-${Date.now().toString(36)}`;
  const token = `${tag}-rule-token`;
  const headerValue = `${tag}-partner-key`;
  let ruleId: number | null = null;
  try {
    const { readZipEntries, ndjsonRows } = await import('../fixtures/zipReader.js');
    const { DataExportService } = await import('../../services/system/dataExport.service.js');
    const inserted = await pool.query(
      `INSERT INTO event_action_rules (name, event_type, action_type, action_config_json, is_active)
       VALUES ($1, 'InvoiceApproved', 'webhook', $2::jsonb, 0) RETURNING id`,
      [tag, JSON.stringify({ url: 'https://partner.invalid/hook', secretToken: token, headers: { 'X-Partner-Key': headerValue } })]);
    ruleId = Number(inserted.rows[0].id);

    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    await DataExportService.writeExport(out);
    const entries = readZipEntries(Buffer.concat(chunks));
    const wrong: string[] = [];

    for (const [file, body] of entries) {
      const text = body.toString('utf8');
      if (text.includes(token)) wrong.push(`${file} holds the rule token`);
      if (text.includes(headerValue)) wrong.push(`${file} holds the header value`);
      if (!file.endsWith('.ndjson')) continue;
      const found: string[] = [];
      ndjsonRows(body).forEach((row, i) => unmaskedSecretPaths(row, `${file}#${i}`, found));
      if (found.length) wrong.push(`unmasked secret fields: ${found.slice(0, 5).join(', ')}`);
    }
    const rule = ndjsonRows(entries.get('event_action_rules.ndjson')).find(r => Number(r.id) === ruleId);
    const config = (rule?.actionConfigJson ?? {}) as { url?: string; secretToken?: string; headers?: Record<string, string> };
    if (!rule) wrong.push('the rule is missing from the export');
    else if (config.secretToken !== '********' || config.headers?.['X-Partner-Key'] !== '********' || config.url !== 'https://partner.invalid/hook') {
      wrong.push(`rule config exported as ${JSON.stringify(config)} (expected the masked token and header, the address kept)`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `${entries.size} zip entries scanned; rule token and header value masked, address kept`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (ruleId !== null) await pool.query(`DELETE FROM event_action_rules WHERE id = $1`, [ruleId]);
  }
}
