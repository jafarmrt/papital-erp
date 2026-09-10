import bcrypt from 'bcryptjs';
import { DEFAULT_WORKFLOW_PRESETS } from '../constants/presets.js';
import { logger } from '../middleware/logger.js';

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseColumns(clause: string): string[] {
  return clause.split(',').map(c => {
    return c.trim().replace(/^.*?\./, '').replace(/["`]/g, '').trim();
  }).filter(Boolean);
}

// In-memory data store
const tables = new Map<string, any[]>();
const sequences = new Map<string, number>();

function getNextId(tbl: string): number {
  const current = sequences.get(`id_${tbl}`) || (tables.get(tbl)?.length || 0);
  const next = current + 1;
  sequences.set(`id_${tbl}`, next);
  return next;
}

// Pre-populate tables
export function initMockStore() {
  if (tables.size > 0) return;

  // 1. Users table (Admin user: admin / admin)
  const adminPasswordHash = bcrypt.hashSync('admin', 10);
  const adminUser: any = {
    id: 1,
    username: 'admin',
    password: adminPasswordHash,
    full_name: 'مدیر ارشد سامانه',
    fullName: 'مدیر ارشد سامانه',
    role: 'admin',
    avatar_url: '',
    avatarUrl: '',
    must_reset_password: 0,
    mustResetPassword: 0,
    failed_login_count: 0,
    failedLoginCount: 0,
    locked_until: null,
    lockedUntil: null,
    token_version: 0,
    tokenVersion: 0,
    is_deleted: 0,
    isDeleted: 0,
    updated_at: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  tables.set('users', [adminUser]);

  // 2. Roles table
  const adminRole: any = {
    id: 1,
    name: 'مدیر ارشد سیستم',
    code: 'admin',
    description: 'دسترسی کامل سیستمی و مدیریتی',
    permissions: ['*'],
    is_system: 1,
    isSystem: 1
  };
  tables.set('roles', [adminRole]);

  // 3. Warehouses table (user-managed, empty by default)
  tables.set('warehouses', []);

  // 4. App Settings
  const initialSettings = [
    { key: 'invoice_start_number', value: '1000' },
    { key: 'fast_moving_days', value: '30' },
    { key: 'slow_moving_days', value: '90' },
    { key: 'dead_stock_days', value: '180' },
    { key: 'company_name', value: 'سامانه جامع ERP پاپیتال' },
    { key: 'company_phone', value: '' },
    { key: 'company_address', value: '' },
    { key: 'company_logo', value: '' },
    { key: 'currency', value: 'IRR' },
    { key: 'display_timezone', value: 'Asia/Tehran' },
    { key: 'pricing_strategies', value: 'فروشگاه,مصرف‌کننده,عمده' },
    { key: 'project_workflow_presets', value: JSON.stringify(DEFAULT_WORKFLOW_PRESETS) },
    { key: 'runtime_enable_test_endpoints', value: 'false' }
  ];
  tables.set('app_settings', initialSettings);

  // 5. Migrations log
  tables.set('migrations_log', []);

  // 6. Categories table
  tables.set('categories', []);
  // 7. Accounts table
  tables.set('accounts', []);
  // 8. Items table
  tables.set('items', []);
  // 9. Customers table
  tables.set('customers', []);
  // 10. Documents table
  tables.set('documents', []);
  // 11. Transactions table
  tables.set('transactions', []);
}

initMockStore();

function handleInsert(sqlText: string, params: any[], isArrayMode: boolean) {
  const tblMatch = sqlText.match(/insert\s+into\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (!tblMatch) return { rows: [], rowCount: 0 };
  const tbl = tblMatch[1].toLowerCase();

  const colMatch = sqlText.match(/insert\s+into\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^)]+)\)/i);
  if (!colMatch) return { rows: [], rowCount: 0 };
  const cols = parseColumns(colMatch[2]);

  const valPartMatch = sqlText.match(/values\s*([\s\S]+?)(?:\s+on\s+conflict|\s+returning|$)/i);
  if (!valPartMatch) return { rows: [], rowCount: 0 };
  const valPart = valPartMatch[1].trim();

  // Match each row's values (e.g. `(default, $1, $2), (default, $3, $4)`)
  const rowMatches = valPart.match(/\(([^)]+)\)/g) || [valPart];

  let paramIdx = 0;
  const insertedRows: any[] = [];
  const list = tables.get(tbl) || [];

  for (const rMatch of rowMatches) {
    const rawVals = rMatch.replace(/^\(|\)$/g, '').split(',').map(v => v.trim());
    const newRow: any = { id: getNextId(tbl) };

    cols.forEach((col, i) => {
      const ph = rawVals[i];
      let val: any = null;
      if (ph && ph.startsWith('$')) {
        val = params[paramIdx++];
      } else if (ph && ph.toLowerCase() === 'default') {
        val = newRow[col] ?? (col === 'id' ? newRow.id : null);
      } else if (ph) {
        val = ph.replace(/^['"]|['"]$/g, '');
      }

      newRow[col] = val;
      newRow[snakeToCamel(col)] = val;
      newRow[camelToSnake(col)] = val;
    });

    list.push(newRow);
    insertedRows.push(newRow);
  }
  tables.set(tbl, list);

  // Check returning clause
  const retMatch = sqlText.match(/returning\s+(.+)$/i);
  if (retMatch) {
    const retCols = parseColumns(retMatch[1]);
    const mapped = insertedRows.map(row => {
      if (isArrayMode) {
        return retCols.map(c => {
          if (row[c] !== undefined) return row[c];
          if (row[snakeToCamel(c)] !== undefined) return row[snakeToCamel(c)];
          if (row[camelToSnake(c)] !== undefined) return row[camelToSnake(c)];
          return null;
        });
      }
      const resObj: any = {};
      retCols.forEach(c => {
        resObj[c] = row[c] ?? row[snakeToCamel(c)] ?? row[camelToSnake(c)] ?? null;
      });
      return resObj;
    });
    return { rows: mapped, rowCount: mapped.length };
  }

  return { rows: [], rowCount: insertedRows.length };
}

function handleUpdate(sqlText: string, params: any[], isArrayMode: boolean) {
  const tblMatch = sqlText.match(/update\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (!tblMatch) return { rows: [], rowCount: 0 };
  const tbl = tblMatch[1].toLowerCase();

  const setMatch = sqlText.match(/set\s+(.+?)(?:\s+where|\s+returning|$)/i);
  if (!setMatch) return { rows: [], rowCount: 0 };
  const setAssignments = setMatch[1].split(',').map(s => s.trim());

  let list = tables.get(tbl) || [];
  let updatedCount = 0;
  const updatedRows: any[] = [];

  const whereMatch = sqlText.match(/where\s+(.+?)(?:\s+returning|$)/i);
  let targetFilter = (_row: any) => true;

  if (whereMatch) {
    const cond = whereMatch[1];
    const eqMatch = cond.match(/(?:["`]?([a-zA-Z0-9_]+)["`]?\.)?["`]?([a-zA-Z0-9_]+)["`]?\s*=\s*\$(\d+)/i);
    if (eqMatch) {
      const col = (eqMatch[2] || eqMatch[1]).toLowerCase();
      const pIdx = parseInt(eqMatch[3] || eqMatch[2], 10) - 1;
      const val = params[pIdx];
      targetFilter = (r: any) => {
        const rVal = r[col] !== undefined ? r[col] : r[snakeToCamel(col)];
        return String(rVal) === String(val);
      };
    }
  }

  for (const row of list) {
    if (targetFilter(row)) {
      for (const assign of setAssignments) {
        const eqA = assign.match(/["`]?([a-zA-Z0-9_]+)["`]?\s*=\s*\$(\d+)/i);
        if (eqA) {
          const col = eqA[1].toLowerCase();
          const pIdx = parseInt(eqA[2], 10) - 1;
          const val = params[pIdx];
          row[col] = val;
          row[snakeToCamel(col)] = val;
          row[camelToSnake(col)] = val;
        }
      }
      updatedCount++;
      updatedRows.push(row);
    }
  }

  const retMatch = sqlText.match(/returning\s+(.+)$/i);
  if (retMatch) {
    const retCols = parseColumns(retMatch[1]);
    const mapped = updatedRows.map(row => {
      if (isArrayMode) {
        return retCols.map(c => row[c] ?? row[snakeToCamel(c)] ?? row[camelToSnake(c)] ?? null);
      }
      const resObj: any = {};
      retCols.forEach(c => {
        resObj[c] = row[c] ?? row[snakeToCamel(c)] ?? row[camelToSnake(c)] ?? null;
      });
      return resObj;
    });
    return { rows: mapped, rowCount: mapped.length };
  }

  return { rows: [], rowCount: updatedCount };
}

function handleDelete(sqlText: string, params: any[]) {
  const tblMatch = sqlText.match(/delete\s+from\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (!tblMatch) return { rows: [], rowCount: 0 };
  const tbl = tblMatch[1].toLowerCase();

  let list = tables.get(tbl) || [];
  const whereMatch = sqlText.match(/where\s+(.+)$/i);
  let initialLen = list.length;

  if (whereMatch) {
    const cond = whereMatch[1];
    const eqMatch = cond.match(/(?:["`]?([a-zA-Z0-9_]+)["`]?\.)?["`]?([a-zA-Z0-9_]+)["`]?\s*=\s*\$(\d+)/i);
    if (eqMatch) {
      const col = (eqMatch[2] || eqMatch[1]).toLowerCase();
      const pIdx = parseInt(eqMatch[3] || eqMatch[2], 10) - 1;
      const val = params[pIdx];
      list = list.filter((r: any) => {
        const rVal = r[col] !== undefined ? r[col] : r[snakeToCamel(col)];
        return String(rVal) !== String(val);
      });
      tables.set(tbl, list);
    }
  }

  return { rows: [], rowCount: initialLen - list.length };
}

function handleSelect(sqlText: string, params: any[], isArrayMode: boolean) {
  const selectMatch = sqlText.match(/^select\s+([\s\S]+?)\s+from\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (!selectMatch) return { rows: [], rowCount: 0 };

  const rawCols = selectMatch[1];
  const tbl = selectMatch[2].toLowerCase();
  const cols = parseColumns(rawCols);
  let rows = [...(tables.get(tbl) || [])];

  const whereMatch = sqlText.match(/where\s+([\s\S]+?)(?:\s+order\s+by|\s+limit|\s+offset|$)/i);
  if (whereMatch) {
    const cond = whereMatch[1];

    // Filter soft deleted
    if (/is_deleted\s*=\s*0/i.test(cond)) {
      rows = rows.filter((r: any) => (r.is_deleted ?? r.isDeleted ?? 0) === 0);
    }

    // Filter equality col = $N
    const eqMatches = Array.from(cond.matchAll(/(?:["`]?([a-zA-Z0-9_]+)["`]?\.)?["`]?([a-zA-Z0-9_]+)["`]?\s*=\s*\$(\d+)/gi));
    for (const m of eqMatches) {
      const col = (m[2] || m[1]).toLowerCase();
      const pIdx = parseInt(m[3] || m[2], 10) - 1;
      const val = params[pIdx];
      rows = rows.filter((r: any) => {
        const rVal = r[col] !== undefined ? r[col] : r[snakeToCamel(col)];
        return String(rVal) === String(val);
      });
    }

    // Filter inArray col IN (...)
    const inMatches = cond.match(/["`]?([a-zA-Z0-9_]+)["`]?\s+in\s*\(([^)]+)\)/i);
    if (inMatches) {
      const col = inMatches[1].toLowerCase();
      const placeHolders = inMatches[2].match(/\$(\d+)/g) || [];
      const inVals = new Set(placeHolders.map(ph => {
        const idx = parseInt(ph.replace('$', ''), 10) - 1;
        return String(params[idx]);
      }));
      if (inVals.size > 0) {
        rows = rows.filter((r: any) => {
          const rVal = r[col] !== undefined ? r[col] : r[snakeToCamel(col)];
          return inVals.has(String(rVal));
        });
      }
    }
  }

  // Handle limit
  const limitMatch = sqlText.match(/limit\s+(\d+|\$\d+)/i);
  if (limitMatch) {
    let lim = 100;
    if (limitMatch[1].startsWith('$')) {
      const idx = parseInt(limitMatch[1].replace('$', ''), 10) - 1;
      lim = parseInt(String(params[idx]), 10) || 100;
    } else {
      lim = parseInt(limitMatch[1], 10) || 100;
    }
    rows = rows.slice(0, lim);
  }

  if (isArrayMode) {
    const mapped = rows.map((r: any) => {
      return cols.map(c => {
        if (r[c] !== undefined) return r[c];
        if (r[snakeToCamel(c)] !== undefined) return r[snakeToCamel(c)];
        if (r[camelToSnake(c)] !== undefined) return r[camelToSnake(c)];
        return null;
      });
    });
    return { rows: mapped, rowCount: mapped.length };
  }

  return { rows, rowCount: rows.length };
}

export function executeMockQuery(q: any, values?: any[]): { rows: any[]; rowCount: number } {
  const sqlText = typeof q === 'string' ? q : (q?.text || '');
  const params = typeof q === 'string' ? (values || []) : (q?.values || values || []);
  const isArrayMode = Boolean(typeof q === 'object' && q?.rowMode === 'array');
  const trimmed = sqlText.trim();

  // 1. Transaction & Session commands
  if (/^\s*(SET|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(trimmed)) {
    return { rows: [], rowCount: 0 };
  }

  // 2. DDL commands
  if (/^\s*(CREATE|ALTER|DROP)\b/i.test(trimmed) || /^\s*DO\s+\$\$/i.test(trimmed)) {
    return { rows: [], rowCount: 0 };
  }

  // 3. SELECT 1 (health check)
  if (/^SELECT\s+1\b/i.test(trimmed)) {
    return isArrayMode
      ? { rows: [[1]], rowCount: 1 }
      : { rows: [{ '?column?': 1, '1': 1 }], rowCount: 1 };
  }

  // 4. SELECT NOW()
  if (/^SELECT\s+NOW\(\)/i.test(trimmed)) {
    const now = new Date().toISOString();
    return isArrayMode
      ? { rows: [[now]], rowCount: 1 }
      : { rows: [{ now }], rowCount: 1 };
  }

  // 5. Advisory locks
  if (/pg_try_advisory_lock/i.test(trimmed)) {
    return isArrayMode
      ? { rows: [[true]], rowCount: 1 }
      : { rows: [{ pg_try_advisory_lock: true, acquired: true }], rowCount: 1 };
  }
  if (/pg_advisory_unlock/i.test(trimmed)) {
    return isArrayMode
      ? { rows: [[true]], rowCount: 1 }
      : { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
  }

  // 6. nextval
  if (/nextval/i.test(trimmed)) {
    const seqMatch = trimmed.match(/nextval\(['"]([^'"]+)['"]\)/i);
    const seqName = seqMatch ? seqMatch[1] : 'default_seq';
    const current = sequences.get(seqName) || 1000;
    const next = current + 1;
    sequences.set(seqName, next);
    return isArrayMode
      ? { rows: [[next]], rowCount: 1 }
      : { rows: [{ nextval: String(next) }], rowCount: 1 };
  }

  // 7. Migrations log query
  if (/from\s+["`]?migrations_log["`]?/i.test(trimmed)) {
    const list = tables.get('migrations_log') || [];
    if (/select\s+name/i.test(trimmed)) {
      return { rows: list.map((item: any) => ({ name: item.name || item })), rowCount: list.length };
    }
  }

  // 8. Count queries: SELECT count(*) FROM ...
  if (/count\(\*\)/i.test(trimmed)) {
    const fromMatch = trimmed.match(/from\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
    const tbl = fromMatch ? fromMatch[1].toLowerCase() : '';
    let list = tables.get(tbl) || [];
    if (/is_deleted\s*=\s*0/i.test(trimmed)) {
      list = list.filter((r: any) => (r.is_deleted ?? r.isDeleted ?? 0) === 0);
    }
    const count = list.length;
    return isArrayMode
      ? { rows: [[count]], rowCount: 1 }
      : { rows: [{ count: count, userCount: count }], rowCount: 1 };
  }

  // 9. INSERT INTO ...
  if (/^insert\s+into/i.test(trimmed)) {
    return handleInsert(trimmed, params, isArrayMode);
  }

  // 10. UPDATE ...
  if (/^update\s+/i.test(trimmed)) {
    return handleUpdate(trimmed, params, isArrayMode);
  }

  // 11. DELETE FROM ...
  if (/^delete\s+from/i.test(trimmed)) {
    return handleDelete(trimmed, params);
  }

  // 12. SELECT ... FROM ...
  if (/^select\s+/i.test(trimmed)) {
    return handleSelect(trimmed, params, isArrayMode);
  }

  return { rows: [], rowCount: 0 };
}

export const mockClient = {
  query: async (q: any, values?: any[]) => executeMockQuery(q, values),
  release: () => {},
  on: () => {},
  removeListener: () => {}
};

export const mockPool = {
  connect: async () => mockClient,
  query: async (q: any, values?: any[]) => executeMockQuery(q, values),
  on: () => {},
  removeListener: () => {},
  end: async () => {},
  totalCount: 1,
  idleCount: 1,
  waitingCount: 0
};
