import { inArray } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, documents, items, itemWarehouseStocks, personnel, pieceworkLogs, pieceworkTasks, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
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

  if (shouldRun('sec_project_options_td_889', 'security', 'td889', 'projects', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_project_options_td_889',
      name: 'v9.0.122: forms of other sections read the project pick list; the full project list opens only with projects.view (TD-889)',
      details: 'for each form key of another section (documents.view, documents.create, warehouse.view, warehouse.in, warehouse.out, piecework.view, piecework.log, daily_logs.view, daily_logs.create): GET /api/projects is 403 and GET /api/projects/options returns the project with exactly the pick fields (code, title, status, customer name); projects.view reads the project list and the project record with inventory control; the status filter and limit work; a key of no picking form gets 403; a project record opens for projects.view and warehouse.view (project inventory page) and no longer for document keys',
    }, async (h, wrong) => {
      const { PROJECT_PICK_FIELDS } = await import('../../lib/permissions/pickLists.js');
      const [project] = await orm.insert(productionProjects).values({
        projectCode: `PRJ_${h.tag}`,
        title: `ERP-TEST-MARKER project ${h.tag}`,
        customerName: `Customer ${h.tag}`,
        status: 'in_progress',
        inventoryControl: { reservedItems: [{ itemId: 1, qty: 3 }] },
      }).returning({ id: productionProjects.id, projectCode: productionProjects.projectCode });
      try {
        const search = `search=${encodeURIComponent(project.projectCode)}`;
        const rowOf = (body: unknown): Row | undefined => {
          const list = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Row[] }).data : (Array.isArray(body) ? body as Row[] : []);
          return list.find(r => r.id === project.id);
        };
        const expected = new Set<string>(PROJECT_PICK_FIELDS);
        const checkPick = (label: string, row: Row | undefined) => {
          if (!row) { wrong.push(`${label}: the project is missing from the pick list`); return; }
          const extra = Object.keys(row).filter(k => !expected.has(k));
          const missing = [...expected].filter(k => !(k in row));
          if (extra.length > 0) wrong.push(`${label}: pick row carries ${extra.join(', ')}`);
          if (missing.length > 0) wrong.push(`${label}: pick row lacks ${missing.join(', ')}`);
          if (row.project_code !== project.projectCode || row.status !== 'in_progress' || row.customer_name !== `Customer ${h.tag}`) {
            wrong.push(`${label}: pick row is ${JSON.stringify(row)}`);
          }
        };

        for (const key of ['documents.view', 'documents.create', 'warehouse.view', 'warehouse.in', 'warehouse.out', 'piecework.view', 'piecework.log', 'daily_logs.view', 'daily_logs.create']) {
          const s = await h.sessionWith([key]);
          const full = await h.get(`/api/projects?${search}`, s);
          if (full.status !== 403) wrong.push(`${key}: GET /api/projects returned ${full.status}, not 403`);
          const options = await h.get(`/api/projects/options?${search}`, s);
          if (options.status !== 200) { wrong.push(`${key}: GET /api/projects/options returned ${options.status}, not 200`); continue; }
          checkPick(key, rowOf(options.body));
        }

        const viewer = await h.sessionWith(['projects.view']);
        const fullList = await h.get(`/api/projects?${search}`, viewer);
        // v9.0.388 (TD-743): the list is a summary page; the inventory control comes with the project record
        const viewerRecord = await h.get(`/api/projects/${project.id}`, viewer);
        const reserved = ((viewerRecord.body as Row | undefined)?.inventory_control as { reservedItems?: unknown[] } | undefined)?.reservedItems;
        if (fullList.status !== 200 || !rowOf(fullList.body) || viewerRecord.status !== 200 || !Array.isArray(reserved) || reserved.length !== 1) {
          wrong.push(`projects.view: list returned ${fullList.status}, record ${viewerRecord.status} with reservations ${JSON.stringify(reserved)}`);
        }
        checkPick('projects.view', rowOf((await h.get(`/api/projects/options?${search}`, viewer)).body));

        if (rowOf((await h.get(`/api/projects/options?status=completed&${search}`, viewer)).body)) wrong.push('status=completed: the running project is in the pick list');
        const limited = await h.get('/api/projects/options?limit=1', viewer);
        const limitedRows = (limited.body as { data?: unknown[] })?.data;
        if (limited.status !== 200 || !Array.isArray(limitedRows) || limitedRows.length !== 1) wrong.push(`limit=1 returned ${limited.status} with ${Array.isArray(limitedRows) ? limitedRows.length : 'no'} rows`);

        const refused = await h.get(`/api/projects/options?${search}`, await h.sessionWith(['crm.view']));
        if (refused.status !== 403) wrong.push(`crm.view: GET /api/projects/options returned ${refused.status}, not 403`);

        for (const [key, status] of [['projects.view', 200], ['warehouse.view', 200], ['documents.create', 403], ['warehouse.in', 403]] as const) {
          const record = await h.get(`/api/projects/${project.id}`, await h.sessionWith([key]));
          if (record.status !== status) wrong.push(`${key}: GET /api/projects/:id returned ${record.status}, not ${status}`);
        }
      } finally {
        await orm.delete(productionProjects).where(inArray(productionProjects.id, [project.id])).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_document_read_scope_td_890', 'security', 'td890', 'documents', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_document_read_scope_td_890',
      name: 'v9.0.123: the full document list opens only with document keys; the stock count page reads only stock count and transfer documents (TD-890)',
      details: 'GET /api/documents is 403 for warehouse.view, warehouse.in, warehouse.out, crm.view, workflow.view and for audit.view outside the audit and transfer types; documents.view lists the invoice; audit.view lists and opens the stock count document (by id and by reference) but not the invoice; workflow.view opens a document record; the stock count sheet needs audit.view; the next number opens for warehouse.in and warehouse.transfer and not for crm.view; the party dossier documents open for customers.view and crm.view and not for warehouse.view',
    }, async (h, wrong) => {
      const { createTestCustomer, createTestDocument } = await import('../fixtures/factories.js');
      const party = await createTestCustomer({ name: `ERP-TEST-MARKER party ${h.tag}` });
      const invoice = (await createTestDocument({ type: 'invoice', status: 'final', refNumber: `INVD${h.tag}`, buyerName: party.name })).document;
      const stockCount = (await createTestDocument({ type: 'audit', status: 'final', refNumber: `AUDD${h.tag}` })).document;
      try {
        const ids = (body: unknown): number[] => {
          const list = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Row[] }).data : (Array.isArray(body) ? body as Row[] : []);
          return list.map(r => Number(r.id));
        };
        const expect = async (label: string, url: string, keys: readonly string[], status: number, contains?: number) => {
          for (const key of keys) {
            const res = await h.get(url, await h.sessionWith([key]));
            if (res.status !== status) wrong.push(`${key}: ${label} returned ${res.status}, not ${status}`);
            else if (contains !== undefined && !ids(res.body).includes(contains)) wrong.push(`${key}: ${label} does not list document ${contains}`);
          }
        };

        await expect('GET /api/documents?type=invoice', '/api/documents?type=invoice&limit=500', ['warehouse.view', 'warehouse.in', 'warehouse.out', 'crm.view', 'workflow.view', 'audit.view'], 403);
        await expect('GET /api/documents?type=invoice', '/api/documents?type=invoice&limit=500', ['documents.view'], 200, invoice.id);
        await expect('GET /api/documents?type=audit', '/api/documents?type=audit&limit=500', ['audit.view'], 200, stockCount.id);
        await expect('GET /api/documents without a type', '/api/documents', ['audit.view'], 403);

        await expect('GET /api/documents/:id (stock count)', `/api/documents/${stockCount.id}`, ['audit.view', 'documents.view'], 200);
        await expect('GET /api/documents/:id (invoice)', `/api/documents/${invoice.id}`, ['audit.view', 'warehouse.view', 'warehouse.in', 'crm.view'], 403);
        await expect('GET /api/documents/:id (invoice)', `/api/documents/${invoice.id}`, ['documents.view', 'workflow.view'], 200);
        await expect('GET /api/documents/by-ref (stock count)', `/api/documents/by-ref/${stockCount.refNumber}?type=audit`, ['audit.view'], 200);
        await expect('GET /api/documents/by-ref (invoice)', `/api/documents/by-ref/${invoice.refNumber}?type=invoice`, ['audit.view'], 403);

        await expect('GET /api/documents/audit-items', '/api/documents/audit-items', ['audit.view'], 200);
        await expect('GET /api/documents/audit-items', '/api/documents/audit-items', ['documents.view', 'warehouse.view', 'crm.view'], 403);

        await expect('GET /api/documents/next-ref?type=receipt', '/api/documents/next-ref?type=receipt', ['warehouse.in'], 200);
        await expect('GET /api/documents/next-ref?type=transfer', '/api/documents/next-ref?type=transfer', ['warehouse.transfer', 'audit.view'], 200);
        await expect('GET /api/documents/next-ref?type=invoice', '/api/documents/next-ref?type=invoice', ['crm.view', 'workflow.view'], 403);

        await expect('GET /api/customers/:id/documents', `/api/customers/${party.id}/documents`, ['customers.view', 'crm.view', 'documents.view'], 200, invoice.id);
        await expect('GET /api/customers/:id/documents', `/api/customers/${party.id}/documents`, ['warehouse.view', 'workflow.view'], 403);
      } finally {
        await orm.delete(documents).where(inArray(documents.id, [invoice.id, stockCount.id])).catch(() => undefined);
        await orm.delete(customers).where(inArray(customers.id, [party.id])).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_item_prices_scope_td_891', 'security', 'td891', 'prices', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_item_prices_scope_td_891',
      name: 'v9.0.124: the invoice form reads an item\'s sale prices; all prices and the price history need a products key (TD-891)',
      details: 'documents.create and documents.edit read GET /api/items/:id/prices (was 403 for the invoice form) and get 403 on GET /api/items/prices/all and the price history; projects.view gets 403 on all three (it opened every price for a list the project window never used); products.view and products.edit_price read all three',
    }, async (h, wrong) => {
      const { createTestItem } = await import('../fixtures/factories.js');
      const item = await createTestItem({ code: `PRC${h.tag}` });
      try {
        const routes = [`/api/items/${item.id}/prices`, '/api/items/prices/all', `/api/items/${item.id}/prices/history`];
        const expected: Array<[string, number[]]> = [
          ['documents.create', [200, 403, 403]],
          ['documents.edit', [200, 403, 403]],
          ['projects.view', [403, 403, 403]],
          ['warehouse.view', [403, 403, 403]],
          ['products.view', [200, 200, 200]],
          ['products.edit_price', [200, 200, 200]],
        ];
        for (const [key, statuses] of expected) {
          const s = await h.sessionWith([key]);
          for (const [i, url] of routes.entries()) {
            const res = await h.get(url, s);
            if (res.status !== statuses[i]) wrong.push(`${key}: GET ${url.replace(String(item.id), ':id')} returned ${res.status}, not ${statuses[i]}`);
          }
        }
      } finally {
        await orm.delete(items).where(inArray(items.id, [item.id])).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_piecework_read_scope_td_892', 'security', 'td892', 'piecework', 'pick', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_piecework_read_scope_td_892',
      name: 'v9.0.125: every personnel\'s work logs and special rates need a piecework key; projects.view reads one project\'s logs (TD-892)',
      details: 'GET /api/piecework/logs: piecework.view, piecework.log and personnel.manage list both logs; projects.view gets 403 without a project and with projectId=ALL, and only that project\'s log with its id; settings.manage gets 403; personnel rates: piecework.view and personnel.manage 200, projects.view and settings.manage 403; task titles stay open to projects.view and settings.manage',
    }, async (h, wrong) => {
      const [worker] = await orm.insert(personnel).values({ fullName: `ERP-TEST-MARKER worker ${h.tag}` }).returning({ id: personnel.id });
      const [task] = await orm.insert(pieceworkTasks).values({ code: `PWT${h.tag}`, title: `ERP-TEST-MARKER task ${h.tag}` }).returning({ id: pieceworkTasks.id });
      const [project] = await orm.insert(productionProjects).values({ projectCode: `PRJ_PW${h.tag}`, title: `ERP-TEST-MARKER project ${h.tag}` }).returning({ id: productionProjects.id });
      const logRow = (projectId: number | null) => ({ personnelId: worker.id, taskId: task.id, projectId, date: '2026-10-01', quantity: 2, unitRate: money(1500), totalAmount: money(3000) });
      const inserted = await orm.insert(pieceworkLogs).values([logRow(project.id), logRow(null)]).returning({ id: pieceworkLogs.id });
      const [projectLog, otherLog] = inserted.map(r => r.id);
      try {
        const logIds = (body: unknown) => (Array.isArray(body) ? body as Row[] : []).map(r => Number(r.id));
        for (const key of ['piecework.view', 'piecework.log', 'personnel.manage']) {
          const res = await h.get(`/api/piecework/logs?personnelId=${worker.id}`, await h.sessionWith([key]));
          const ids = logIds(res.body);
          if (res.status !== 200 || !ids.includes(projectLog) || !ids.includes(otherLog)) wrong.push(`${key}: work logs returned ${res.status} with ${JSON.stringify(ids)}`);
        }
        const planner = await h.sessionWith(['projects.view']);
        for (const url of [`/api/piecework/logs?personnelId=${worker.id}`, '/api/piecework/logs?projectId=ALL']) {
          const res = await h.get(url, planner);
          if (res.status !== 403) wrong.push(`projects.view: GET ${url} returned ${res.status}, not 403`);
        }
        const scoped = await h.get(`/api/piecework/logs?projectId=${project.id}`, planner);
        if (scoped.status !== 200 || JSON.stringify(logIds(scoped.body)) !== JSON.stringify([projectLog])) {
          wrong.push(`projects.view: the project's logs returned ${scoped.status} with ${JSON.stringify(logIds(scoped.body))}`);
        }
        const settings = await h.sessionWith(['settings.manage']);
        const bySettings = await h.get('/api/piecework/logs', settings);
        if (bySettings.status !== 403) wrong.push(`settings.manage: work logs returned ${bySettings.status}, not 403`);

        for (const [key, status] of [['piecework.view', 200], ['personnel.manage', 200], ['projects.view', 403], ['settings.manage', 403]] as const) {
          const rates = await h.get(`/api/piecework/personnel-rates/${worker.id}`, await h.sessionWith([key]));
          if (rates.status !== status) wrong.push(`${key}: personnel rates returned ${rates.status}, not ${status}`);
        }
        for (const s of [planner, settings]) {
          const tasks = await h.get('/api/piecework/tasks', s);
          if (tasks.status !== 200) wrong.push(`task titles returned ${tasks.status} for a project or settings user`);
        }
      } finally {
        await orm.delete(pieceworkLogs).where(inArray(pieceworkLogs.id, [projectLog, otherLog])).catch(() => undefined);
        await orm.delete(pieceworkTasks).where(inArray(pieceworkTasks.id, [task.id])).catch(() => undefined);
        await orm.delete(productionProjects).where(inArray(productionProjects.id, [project.id])).catch(() => undefined);
        await orm.delete(personnel).where(inArray(personnel.id, [worker.id])).catch(() => undefined);
      }
    });
  }

  return results;
}
