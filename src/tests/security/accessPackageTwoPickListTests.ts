import { inArray } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, items, itemWarehouseStocks } from '../../db/schema.js';
import { runCase, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M6 — فهرست‌های انتخاب (تصمیم ت۱۰ الف): فرم بخش دیگر از فهرست انتخاب کمینه می‌خواند و فهرست کامل هر
 * بخش فقط با مجوز مشاهده همان بخش باز است. مسیرهای واقعی Express؛ هر مورد روی کد پیشین قرمز است.
 */

export async function runAccessPackageTwoPickListTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_customer_options_td_887', 'security', 'td887', 'customers', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_customer_options_td_887',
      name: 'v9.0.120: forms of other sections read the customer pick list; the full customer list opens only with customers.view (TD-887)',
      details: 'for each form key of another section (documents.view, documents.create, warehouse.in, warehouse.view, products.view, crm.view, projects.view, procurement.view, accounting.view): GET /api/customers is 403 and GET /api/customers/options returns the party with exactly the pick fields (bank details only for accounting.view, TD-433); customers.view reads the full list with notes and version; a key of no picking form gets 403; the account card refuses documents.view alone',
    }, async (h, wrong) => {
      const { CUSTOMER_PICK_FIELDS } = await import('../../lib/permissions/pickLists.js');
      const { createTestCustomer } = await import('../fixtures/factories.js');
      const bankInfo = { bankName: 'بانک ملت', accountNumber: `40${h.tag}`, shaba: `IR0601200000000${h.tag}123456`, cardNumber: `6104337${h.tag}123` };
      const party = await createTestCustomer({
        name: `طرف حساب فهرست انتخاب ${h.tag}`, partyType: 'supplier', phone: `0912${h.tag}5`, address: 'تهران، خیابان آزادی',
        notes: 'یادداشت داخلی: بدقول', bankInfo, contacts: [{ name: 'رابط', phone: `0935${h.tag}1`, isPrimary: true }],
      });
      try {
        const search = `search=${encodeURIComponent(party.name)}`;
        const rowOf = (body: unknown): Row | undefined => {
          const list = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Row[] }).data : (Array.isArray(body) ? body as Row[] : []);
          return list.find(r => r.id === party.id);
        };

        const formKeys = ['documents.view', 'documents.create', 'warehouse.in', 'warehouse.view', 'products.view', 'crm.view', 'projects.view', 'procurement.view', 'accounting.view'];
        for (const key of formKeys) {
          const s = await h.sessionWith([key]);
          const full = await h.get(`/api/customers?${search}`, s);
          if (full.status !== 403) wrong.push(`${key}: GET /api/customers returned ${full.status}, not 403`);
          const options = await h.get(`/api/customers/options?${search}`, s);
          if (options.status !== 200) { wrong.push(`${key}: GET /api/customers/options returned ${options.status}, not 200`); continue; }
          const row = rowOf(options.body);
          if (!row) { wrong.push(`${key}: the party is missing from the pick list`); continue; }
          const expected = new Set<string>([...CUSTOMER_PICK_FIELDS, ...(key === 'accounting.view' ? ['bankInfo'] : [])]);
          const extra = Object.keys(row).filter(k => !expected.has(k));
          const missing = [...expected].filter(k => !(k in row));
          if (extra.length > 0) wrong.push(`${key}: pick row carries ${extra.join(', ')}`);
          if (missing.length > 0) wrong.push(`${key}: pick row lacks ${missing.join(', ')}`);
          if (row.address !== 'تهران، خیابان آزادی') wrong.push(`${key}: pick row address is ${String(row.address)}`);
          if (key === 'accounting.view' && (row.bankInfo as { shaba?: string } | undefined)?.shaba !== bankInfo.shaba) wrong.push('accounting.view: pick row lacks the bank details');
        }

        const viewer = await h.sessionWith(['customers.view']);
        const fullList = await h.get(`/api/customers?${search}`, viewer);
        const fullRow = rowOf(fullList.body);
        if (fullList.status !== 200 || fullRow?.notes !== 'یادداشت داخلی: بدقول' || fullRow?.version === undefined) {
          wrong.push(`customers.view: full list returned ${fullList.status} with notes ${String(fullRow?.notes)} and version ${String(fullRow?.version)}`);
        }
        const viewerOptions = rowOf((await h.get(`/api/customers/options?${search}`, viewer)).body);
        if ((viewerOptions?.bankInfo as { shaba?: string } | undefined)?.shaba !== bankInfo.shaba) wrong.push('customers.view: pick row lacks the bank details');
        if (viewerOptions && 'notes' in viewerOptions) wrong.push('customers.view: pick row carries notes');

        const outsider = await h.sessionWith(['piecework.view']);
        const refused = await h.get(`/api/customers/options?${search}`, outsider);
        if (refused.status !== 403) wrong.push(`piecework.view: GET /api/customers/options returned ${refused.status}, not 403`);

        const limited = await h.get(`/api/customers/options?limit=1&${search}`, viewer);
        const limitedRows = (limited.body as { data?: unknown[] })?.data;
        if (limited.status !== 200 || !Array.isArray(limitedRows) || limitedRows.length !== 1) wrong.push(`limit=1 returned ${limited.status} with ${Array.isArray(limitedRows) ? limitedRows.length : 'no'} rows`);

        const card = await h.get(`/api/customers/${party.id}/account-card`, await h.sessionWith(['documents.view']));
        if (card.status !== 403) wrong.push(`documents.view alone: account card returned ${card.status}, not 403`);
      } finally {
        await orm.delete(customers).where(inArray(customers.id, [party.id])).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_item_options_td_888', 'security', 'td888', 'items', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_item_options_td_888',
      name: 'v9.0.121: forms of other sections read the item pick list; the full item list and the average cost need products.view (TD-888)',
      details: 'for each form key of another section (documents.view, documents.create, warehouse.view, warehouse.in, audit.view, projects.view, crm.view, procurement.view): GET /api/items is 403 and GET /api/items/options returns the item with exactly the pick fields and its warehouse stock, without the average cost; products.view reads the full list with reorder point and the pick list with the average cost; the type filter and limit work; a key of no picking form gets 403; the reorder alerts page opens only with its page keys',
    }, async (h, wrong) => {
      const { ITEM_PICK_FIELDS, ITEM_COST_FIELDS, ITEM_WAREHOUSE_STOCK_FIELD } = await import('../../lib/permissions/pickLists.js');
      const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
      const warehouse = await createTestWarehouse({ code: `WHP${h.tag}` });
      const item = await createTestItem({ type: 'raw_material', code: `PICK${h.tag}`, weightedAverageCost: 73000, reorderPoint: 500, stocks: { [warehouse.code]: 12 } });
      try {
        const search = `search=${encodeURIComponent(item.code)}`;
        const rowOf = (body: unknown): Row | undefined => {
          const list = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Row[] }).data : (Array.isArray(body) ? body as Row[] : []);
          return list.find(r => r.id === item.id);
        };
        const costFields = new Set<string>(ITEM_COST_FIELDS);
        const checkPick = (label: string, row: Row | undefined, withCost: boolean) => {
          if (!row) { wrong.push(`${label}: the item is missing from the pick list`); return; }
          const expected = new Set<string>([...ITEM_PICK_FIELDS, ...(withCost ? ITEM_COST_FIELDS : [])]);
          const extra = Object.keys(row).filter(k => !expected.has(k) && !ITEM_WAREHOUSE_STOCK_FIELD.test(k));
          const missing = [...expected].filter(k => !(k in row));
          if (extra.length > 0) wrong.push(`${label}: pick row carries ${extra.join(', ')}`);
          if (missing.length > 0) wrong.push(`${label}: pick row lacks ${missing.join(', ')}`);
          if (Number(row[`stock_${warehouse.code}`]) !== 12 || Number((row.stocks as Record<string, number> | undefined)?.[warehouse.code]) !== 12) {
            wrong.push(`${label}: pick row stock in ${warehouse.code} is ${String(row[`stock_${warehouse.code}`])}`);
          }
          if (withCost && Number(row.weighted_average_cost) !== 73000) wrong.push(`${label}: pick row average cost is ${String(row.weighted_average_cost)}`);
          if (!withCost && Object.keys(row).some(k => costFields.has(k))) wrong.push(`${label}: pick row carries the average cost`);
        };

        for (const key of ['documents.view', 'documents.create', 'warehouse.view', 'warehouse.in', 'audit.view', 'projects.view', 'crm.view', 'procurement.view']) {
          const s = await h.sessionWith([key]);
          const full = await h.get(`/api/items?${search}`, s);
          if (full.status !== 403) wrong.push(`${key}: GET /api/items returned ${full.status}, not 403`);
          const options = await h.get(`/api/items/options?${search}`, s);
          if (options.status !== 200) { wrong.push(`${key}: GET /api/items/options returned ${options.status}, not 200`); continue; }
          checkPick(key, rowOf(options.body), false);
        }

        const viewer = await h.sessionWith(['products.view']);
        const fullList = await h.get(`/api/items?${search}`, viewer);
        const fullRow = rowOf(fullList.body);
        if (fullList.status !== 200 || Number(fullRow?.reorder_point) !== 500 || Number(fullRow?.weighted_average_cost) !== 73000) {
          wrong.push(`products.view: full list returned ${fullList.status} with reorder point ${String(fullRow?.reorder_point)} and cost ${String(fullRow?.weighted_average_cost)}`);
        }
        checkPick('products.view', rowOf((await h.get(`/api/items/options?${search}`, viewer)).body), true);

        const products = rowOf((await h.get(`/api/items/options?type=product&${search}`, viewer)).body);
        if (products) wrong.push('type=product: the raw material is in the pick list');
        const limited = await h.get(`/api/items/options?limit=1`, viewer);
        const limitedRows = (limited.body as { data?: unknown[] })?.data;
        if (limited.status !== 200 || !Array.isArray(limitedRows) || limitedRows.length !== 1) wrong.push(`limit=1 returned ${limited.status} with ${Array.isArray(limitedRows) ? limitedRows.length : 'no'} rows`);

        const refused = await h.get(`/api/items/options?${search}`, await h.sessionWith(['piecework.view']));
        if (refused.status !== 403) wrong.push(`piecework.view: GET /api/items/options returned ${refused.status}, not 403`);

        const alertsByWarehouse = await h.get('/api/items/reorder-alerts', await h.sessionWith(['warehouse.view']));
        if (alertsByWarehouse.status !== 200) wrong.push(`warehouse.view: reorder alerts returned ${alertsByWarehouse.status}, not 200`);
        const alertsByDocuments = await h.get('/api/items/reorder-alerts', await h.sessionWith(['documents.view']));
        if (alertsByDocuments.status !== 403) wrong.push(`documents.view: reorder alerts returned ${alertsByDocuments.status}, not 403`);
      } finally {
        await orm.delete(itemWarehouseStocks).where(inArray(itemWarehouseStocks.itemId, [item.id])).catch(() => undefined);
        await orm.delete(items).where(inArray(items.id, [item.id])).catch(() => undefined);
      }
    });
  }

  return results;
}
