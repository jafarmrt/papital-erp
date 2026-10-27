import type { Express } from 'express';
import { GUARD_ENTRIES } from '../middleware/authorize.js';
import { AUTHENTICATES, isAuthExemptPath } from '../middleware/auth.js';
import { VALIDATES } from '../middleware/validate.js';
import { IDEMPOTENT } from '../middleware/idempotencyMark.js';

/**
 * جدول «مسیر ← مجوز» از خود روترهای Express (حوزه H نقشه راه V8).
 * برای هر مسیر: متد، مسیر کامل، این‌که احراز هویت پیش از آن اجرا می‌شود، و گاردهای `authorize` /
 * `authorizePermission` آن (هر گارد فهرست «یکی از این‌ها کافی است»؛ چند گارد پشت هم همه لازم‌اند).
 * میدل‌ور سطح روتر (`router.use(...)` بی‌مسیر) روی همه مسیرهای بعدی همان روتر و، چون روترها روی `/api`
 * سوار شده‌اند، روی همه مسیرهای روترهای بعدی با همان پیشوند هم اجرا می‌شود؛ این‌جا هم به همان ترتیب جمع می‌شود.
 */
export interface RouteGuardRow {
  method: string;
  path: string;
  authenticated: boolean;
  guards: string[][];
  /** v10.0.35 (TD-979): خود route میدل‌ور `validate` دارد */
  validated: boolean;
  /** v10.0.35 (TD-979): اسکیمای `validate` آن کلید `body` دارد */
  validatesBody: boolean;
  /** v10.1.64 (OBS-R2-14): the route itself runs the `idempotency` middleware */
  idempotent: boolean;
}

interface ExpressLayer {
  name?: string;
  handle: unknown;
  /** Express 5 (router 2): true for a path-less `use` */
  slash?: boolean;
  /** the literal path an `app.use(path, …)` mounted this layer at (`recordMountPaths`) */
  [MOUNT_PATH]?: string;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: ExpressLayer[] };
}

/** Express 5 keeps no mount path on a layer (only its matcher), so `app.use(path, …)` records it here. */
export const MOUNT_PATH = Symbol.for('erp.routeMountPath');

interface MountableApp {
  use: (...args: unknown[]) => unknown;
  router: { stack: ExpressLayer[] };
}

/**
 * Wraps `app.use` once so every layer it adds under a string path carries that path. Only the app's own `use` is
 * wrapped: a prefix given to `router.use(path, …)` inside a mounted router is not recorded and shows as «?» in the
 * route table, so routers mount their sub-routers under path-less `use` (as every router does today).
 */
export function recordMountPaths(app: Express): void {
  const target = app as unknown as MountableApp;
  const original = target.use.bind(target);
  target.use = (...args: unknown[]) => {
    const before = target.router.stack.length;
    const result = original(...args);
    if (typeof args[0] === 'string') {
      for (const layer of target.router.stack.slice(before)) layer[MOUNT_PATH] = args[0];
    }
    return result;
  };
}

interface Chain {
  authenticated: boolean;
  guards: string[][];
}

function guardEntriesOf(handle: unknown): string[] | null {
  if (typeof handle !== 'function') return null;
  const entries = (handle as unknown as Record<string, unknown>)[GUARD_ENTRIES];
  return Array.isArray(entries) ? (entries as string[]) : null;
}

/** The router's mount prefix: '' for a path-less `use`, the recorded path of `app.use(path, …)`, else unknown. */
function mountPathOf(layer: ExpressLayer): string {
  if (layer.slash) return '';
  const mount = layer[MOUNT_PATH];
  if (typeof mount !== 'string') return '?';
  return mount === '/' ? '' : mount.replace(/\/+$/, '');
}

function validationOf(stack: ExpressLayer[]): { validated: boolean; validatesBody: boolean } {
  const marks = stack
    .map(layer => (typeof layer.handle === 'function' ? (layer.handle as unknown as Record<string, unknown>)[VALIDATES] : undefined))
    .filter((mark): mark is { body: boolean } => typeof mark === 'object' && mark !== null);
  return { validated: marks.length > 0, validatesBody: marks.some(mark => mark.body) };
}

function applyMiddleware(chain: Chain, handle: unknown): Chain {
  if (typeof handle === 'function' && (handle as unknown as Record<string, unknown>)[AUTHENTICATES] === true) return { ...chain, authenticated: true };
  const entries = guardEntriesOf(handle);
  if (entries) return { ...chain, guards: [...chain.guards, entries] };
  return chain;
}

/** روی پشته یک روتر راه می‌رود؛ زنجیره خروجی همان است که برای لایه‌های بعدی والد (هم‌پیشوند) می‌ماند. */
function walk(stack: ExpressLayer[], prefix: string, inherited: Chain, rows: RouteGuardRow[]): Chain {
  let chain = inherited;
  for (const layer of stack) {
    if (layer.route) {
      let routeChain = chain;
      for (const handlerLayer of layer.route.stack) routeChain = applyMiddleware(routeChain, handlerLayer.handle);
      const validation = validationOf(layer.route.stack);
      const idempotent = layer.route.stack.some(l => typeof l.handle === 'function' && (l.handle as unknown as Record<string, unknown>)[IDEMPOTENT] === true);
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const method of Object.keys(layer.route.methods)) {
        // v11 phase 6.2 (X14): a `router.all` route (the webhooks) is one `ALL` row; before, it was left out of the table.
        // A path `authenticateToken` lets through is public even after a router-level `authenticateToken`.
        const verb = method === '_all' ? 'ALL' : method.toUpperCase();
        for (const p of paths) {
          const full = `${prefix}${p}`;
          rows.push({ method: verb, path: full, authenticated: routeChain.authenticated && !isAuthExemptPath(full), guards: routeChain.guards, ...validation, idempotent });
        }
      }
      continue;
    }
    const sub = (layer.handle as { stack?: ExpressLayer[] } | undefined)?.stack;
    if (layer.name === 'router' && Array.isArray(sub)) {
      const mount = mountPathOf(layer);
      const after = walk(sub, `${prefix}${mount}`, chain, rows);
      // میدل‌ور بی‌مسیر روتر فرزندی که بی‌پیشوند سوار شده، روی لایه‌های بعدی والد هم اجرا می‌شود
      if (mount === '') chain = after;
      continue;
    }
    if (layer.slash) chain = applyMiddleware(chain, layer.handle);
  }
  return chain;
}

export function buildRouteGuardTable(app: Express): RouteGuardRow[] {
  const root = (app as unknown as { router?: { stack: ExpressLayer[] } }).router;
  const rows: RouteGuardRow[] = [];
  if (!root) return rows;
  // app.use('/api', ...) میدل‌ورهای بی‌مسیر سطح app را هم دارد؛ authenticateToken در سطح app سوار نمی‌شود
  const stack = root.stack;
  let chain: Chain = { authenticated: false, guards: [] };
  for (const layer of stack) {
    const sub = (layer.handle as { stack?: ExpressLayer[] } | undefined)?.stack;
    if (layer.name === 'router' && Array.isArray(sub)) {
      const mount = mountPathOf(layer);
      // روترهای سوارشده روی `/api` زنجیره مشترک دارند (پیشوند یکسان)؛ پیشوند خاص‌تر زنجیره خودش را دارد
      const shared = mount === '/api';
      const after = walk(sub, mount, shared ? chain : { ...chain }, rows);
      if (shared) chain = after;
      continue;
    }
    if (layer.route) {
      walk([layer], '', { authenticated: false, guards: [] }, rows);
    }
  }
  return rows;
}

export function formatGuards(row: RouteGuardRow): string {
  if (row.guards.length === 0) return row.authenticated ? 'login-only' : 'public';
  return row.guards.map(g => g.join(' | ')).join(' & ');
}
