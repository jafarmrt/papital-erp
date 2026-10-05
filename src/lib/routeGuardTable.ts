import type { Express } from 'express';
import { GUARD_ENTRIES } from '../middleware/authorize.js';
import { AUTHENTICATES } from '../middleware/auth.js';

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
}

interface ExpressLayer {
  name?: string;
  handle: unknown;
  regexp?: RegExp & { fast_slash?: boolean };
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: ExpressLayer[] };
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

/** پیشوند سوار شدن روتر از regexp لایه Express 4 (`^\/api\/?(?=\/|$)`). */
function mountPathOf(layer: ExpressLayer): string {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';
  const match = re.source.match(/^\^((?:\\\/[^\\?(]+)+)\\\/\?\(\?=\\\/\|\$\)$/);
  if (!match) return '?';
  return match[1].replace(/\\\//g, '/');
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
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        for (const p of paths) {
          rows.push({ method: method.toUpperCase(), path: `${prefix}${p}`, authenticated: routeChain.authenticated, guards: routeChain.guards });
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
    if (!layer.regexp || layer.regexp.fast_slash) chain = applyMiddleware(chain, layer.handle);
  }
  return chain;
}

export function buildRouteGuardTable(app: Express): RouteGuardRow[] {
  const root = (app as unknown as { _router?: { stack: ExpressLayer[] } })._router;
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
