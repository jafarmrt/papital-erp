import { createApp } from '../src/app.js';
import { buildRouteGuardTable, formatGuards } from '../src/lib/routeGuardTable.js';

/**
 * حوزه H نقشه راه V8: جدول «مسیر ← مجوز» از خود روترهای Express، به Markdown.
 *   npm run routes:permissions > docs/security/ROUTE_PERMISSIONS.md
 * سیاستی که این جدول با آن سنجیده می‌شود آزمون sec_route_access_policy_td_298 است (src/tests/security/routeAccessPolicy.ts).
 */
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
