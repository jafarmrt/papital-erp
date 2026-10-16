import { randomBytes } from 'crypto';
import { buildRouteGuardTable, formatGuards } from '../src/lib/routeGuardTable.js';

/**
 * حوزه H نقشه راه V8: جدول «مسیر ← مجوز» از خود روترهای Express، به Markdown.
 *   npm run routes:permissions > docs/security/ROUTE_PERMISSIONS.md
 * سیاستی که این جدول با آن سنجیده می‌شود آزمون sec_route_access_policy_td_298 است (src/tests/security/routeAccessPolicy.ts).
 */
// OBS-R2-112: the table only reads the routers and never serves a request or signs a token, so without a
// JWT_SECRET the app is built with a one-off random secret instead of stopping (a set secret is used as it is)
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { createApp } = await import('../src/app.js');
const app = await createApp();
const rows = buildRouteGuardTable(app).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const cell = (t: string) => t.replace(/\|/g, '\\|');
const lines = [
  '# جدول «مسیر ← مجوز» (Route → Permission)',
  '',
  '> ساخته‌شده با `npm run routes:permissions` از روترهای Express. `public` = بدون ورود؛ `login-only` = فقط ورود',
  '> (مجوز درون هندلر یا داده خود کاربر)؛ «a \\| b» یعنی یکی کافی است و «&» یعنی هر دو گارد لازم است. `admin` همیشه می‌گذرد.',
  '',
  `تعداد مسیرها: ${rows.length}`,
  '',
  '| متد | مسیر | مجوز |',
  '|---|---|---|',
  ...rows.map(r => `| ${r.method} | \`${r.path}\` | ${cell(formatGuards(r))} |`),
  '',
];
process.stdout.write(lines.join('\n'));
process.exit(0);
