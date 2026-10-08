import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';

/**
 * ابزار مشترک آزمون‌های بسته ۱۴ (گردش کار): مسیرهای واقعی Express با ورود واقعی (کوکی و CSRF) و نقش‌های seed یا تازه.
 */

export interface Session { cookie: string; csrfToken: string }
export type Row = Record<string, unknown>;
export type ShouldRun = (id: string, ...extra: string[]) => boolean;

export interface Harness {
  app: unknown;
  admin: Session;
  tag: string;
  get(url: string, s?: Session): Promise<request.Response>;
  post(url: string, body: unknown, s?: Session): Promise<request.Response>;
  put(url: string, body: unknown, s?: Session): Promise<request.Response>;
  del(url: string, s?: Session): Promise<request.Response>;
  /** نشست کاربر تازه با نقش seed‌شده (کد) یا نقش تازه با این مجوزها */
  sessionWith(roleOrPermissions: string | string[]): Promise<Session & { userId: number; role: string }>;
  q(text: string, params?: unknown[]): Promise<Row[]>;
  /** گام‌های فرایند را با کلید اقدام، از گام جاری، با نشست داده‌شده می‌رود */
  walk(instanceId: number, actionKeys: string[], s: Session): Promise<number[]>;
  cleanup(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const h: Harness = {
    app,
    admin,
    tag: String(Date.now()).slice(-6),
    get: (url, s = admin) => request(app).get(url).set('Cookie', s.cookie),
    post: (url, body, s = admin) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url, body, s = admin) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    del: (url, s = admin) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
    async sessionWith(roleOrPermissions) {
      let role: string;
      if (typeof roleOrPermissions === 'string') {
        role = roleOrPermissions;
      } else {
        const created = await createTestRole({ permissions: roleOrPermissions });
        roleIds.push(created.id);
        role = created.code;
      }
      const user = await createTestUser({ role });
      userIds.push(user.id);
      return { ...(await loginTestUserWithSession(app, user.username)), userId: user.id, role };
    },
    async q(text, params = []) {
      return (await pool.query(text, params)).rows as Row[];
    },
    async walk(instanceId, actionKeys, s) {
      const statuses: number[] = [];
      for (const key of actionKeys) {
        const [inst] = await h.q(`SELECT snapshot_dsl, current_state_id FROM workflow_instances WHERE id = $1`, [instanceId]);
        const transitions = ((inst?.snapshot_dsl as { transitions?: Row[] } | null)?.transitions ?? []);
        let trId = transitions.find(t => t.actionKey === key && t.fromStateId === inst?.current_state_id)?.id;
        if (trId === undefined) {
          // فرایند بی تصویر (ساخته‌شده پیش از نسخه‌بندی): انتقال از جدول جاری
          const [row] = await h.q(`SELECT id FROM workflow_transitions WHERE from_state_id = $1 AND action_key = $2 ORDER BY id LIMIT 1`, [inst?.current_state_id, key]);
          trId = row?.id;
        }
        const res = await h.post('/api/workflow/transition', { instanceId, transitionId: trId ?? 999999999 }, s);
        statuses.push(res.status);
        if (res.status >= 300) break;
      }
      return statuses;
    },
    async cleanup() {
      if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
      if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
    },
  };
  return h;
}

export async function runCase(
  results: TestCaseResult[],
  meta: { id: string; name: string; details: string },
  body: (h: Harness, wrong: string[]) => Promise<void>,
): Promise<void> {
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    await body(h, wrong);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id: meta.id, name: meta.name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: meta.details }));
  } catch (err) {
    results.push(makeTestCase({
      id: meta.id, name: meta.name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.cleanup();
  }
}

export async function draftSalesDocument(h: Harness, status: 'draft' | 'proforma' = 'draft'): Promise<number> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  // v9.0.170 (TD-653): نام کالای فعال یکتاست، پس هر سند آزمون کالای هم‌نام تازه نمی‌سازد
  const serial = Math.floor(Math.random() * 1e6);
  const item = await createTestItem({ type: 'product', name: `کالای گردش‌کار ${h.tag} ${serial}`, code: `WF14-${h.tag}-${serial}` });
  return Number(await DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status, date: await businessTodayIsoDate(), user: 'آزمون بسته ۱۴', buyerName: `خریدار ${h.tag}`,
    items: [{ itemId: item.id, quantity: 1, unitPrice: 5000, location: await getDefaultWarehouseCode(orm) }],
  } as never));
}
