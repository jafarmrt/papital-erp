import { expect, request, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_ADMIN } from '../global-setup';
import { isoToJalaliDate } from '../../src/utils/calendarDate';

/**
 * v10 (I-02): shared kit of the four business flow specs (purchase, project production and delivery, payroll and
 * payment, treasury and cheque). The browser drives the step under test; the API prepares what the step needs and
 * the database is read only to check the result down to the accounting voucher rows.
 */
const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT || 3100)}`;

export const LOGIN_TEXT = {
  username: 'نام کاربری',
  password: 'کلمه عبور',
  submit: 'ورود به سیستم',
  signedIn: 'خروج از حساب',
} as const;

export type Json = Record<string, unknown>;

export interface AdminApi {
  api: APIRequestContext;
  /** POST / PUT / DELETE with the session's CSRF token; fails the test on a non-2xx answer. */
  send(method: 'post' | 'put' | 'delete', url: string, data?: unknown): Promise<Json>;
  get(url: string): Promise<Json>;
  dispose(): Promise<void>;
}

async function okJson(label: string, res: APIResponse): Promise<Json> {
  const body = await res.json().catch(() => ({})) as Json;
  if (!res.ok()) throw new Error(`${label}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}

export async function adminApi(): Promise<AdminApi> {
  const api = await request.newContext({ baseURL: BASE_URL });
  const login = await okJson('login', await api.post('/api/login', { data: E2E_ADMIN }));
  const headers = { 'x-csrf-token': String(login.csrfToken) };
  return {
    api,
    send: async (method, url, data) => okJson(`${method.toUpperCase()} ${url}`, await api[method](url, { headers, data })),
    get: async url => okJson(`GET ${url}`, await api.get(url)),
    dispose: () => api.dispose(),
  };
}

/** Unwraps `{ data: x }` answers and plain ones alike. */
export function dataOf<T = Json>(body: Json): T {
  return ('data' in body && body.data !== null && typeof body.data === 'object' ? body.data : body) as T;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder(LOGIN_TEXT.username).fill(E2E_ADMIN.username);
  await page.getByPlaceholder(LOGIN_TEXT.password).fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: LOGIN_TEXT.submit }).click();
  await expect(page.getByText(LOGIN_TEXT.signedIn)).toBeVisible();
}

/** A short suffix that keeps codes and names unique across runs on the same local database. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
}

/** Business today (Asia/Tehran) as Gregorian ISO and Jalali, the way the browser computes it. */
export function businessToday(): { iso: string; jalali: string } {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { iso, jalali: isoToJalaliDate(iso) };
}

let pool: pg.Pool | null = null;

/** Read-only queries against the e2e database (the server writes; the spec only checks). */
export async function db<T extends Json = Json>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) throw new Error('E2E_DATABASE_URL is required to check the ledger');
    pool = new pg.Pool({ connectionString: url, max: 2 });
  }
  return (await pool.query(sql, params)).rows as T[];
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export interface VoucherRow extends Json {
  voucherId: number;
  status: string;
  code: string;
  debit: string;
  credit: string;
  detailedType: string | null;
  detailedId: number | null;
}

/** Active rows of the active vouchers a source points to, e.g. `source_document_id`, `source_payroll_id`. */
export async function voucherRowsOf(sourceColumn: string, sourceId: number): Promise<VoucherRow[]> {
  if (!/^[a-z_]+$/.test(sourceColumn)) throw new Error(`bad source column ${sourceColumn}`);
  return db<VoucherRow>(
    `SELECT v.id AS "voucherId", v.status, a.code, i.debit::text AS debit, i.credit::text AS credit,
            i.detailed_type AS "detailedType", i.detailed_id AS "detailedId"
       FROM journal_vouchers v
       JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
       JOIN accounts a ON a.id = i.account_id
      WHERE v.${sourceColumn} = $1 AND v.is_deleted = 0
      ORDER BY i.id`, [sourceId]);
}

/** Sum of debit minus credit per account code, as numbers (amounts in these flows are whole rials). */
export function netByAccount(rows: VoucherRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.code] = (out[r.code] ?? 0) + Number(r.debit) - Number(r.credit);
  return out;
}

export function expectBalanced(rows: VoucherRow[]): void {
  expect(rows.length).toBeGreaterThan(0);
  const debit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const credit = rows.reduce((s, r) => s + Number(r.credit), 0);
  expect(debit).toBeCloseTo(credit, 2);
}
