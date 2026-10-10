/**
 * v9.0.224 (TD-540, B02-25, owner decisions t8 of package 2 and t7 of package 16): the Persian text of the users, roles,
 * audit log, login, setup and profile screens, the permission catalog and the package's server messages has no English
 * word and no transliteration («داشبورد» → «پیشخوان», «پروفایل» → «نمایه», «ماژول» → «بخش», «آواتار» → «تصویر نمایه»,
 * «لاگ» → «رویداد», «کلاینت» → «دستگاه کاربر», «ویزارد» → «راه‌اندازی اولیه», Snapshot → «تصویر داده», no «کانبان»),
 * counts are shown in Persian digits and the login event shows the role's name, never its code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from '../../pages/UsersPage';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { PERMISSION_CATALOG, SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog';
import { roleDisplayName } from '../../lib/users/roleDisplayName';
import type { PermissionCategory, Role, User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const SRC = join(__dirname, '..', '..');
const PACKAGE_2 = [
  'pages/LoginPage.tsx', 'pages/SetupPage.tsx', 'pages/UsersPage.tsx', 'pages/ActivityLogsPage.tsx',
  'components/users/', 'components/audit/', 'components/auth/', 'components/UserProfileModal.tsx',
  'components/settings/SystemOperationsTab.tsx', 'contexts/AuthContext.tsx',
  'lib/permissions/permissionCatalog.ts', 'lib/permissions/roleTemplates.ts', 'lib/audit/', 'lib/auth/', 'lib/users/',
  'routes/users.routes.ts', 'routes/auth.routes.ts', 'services/auth/', 'services/users/',
];

/** کلیدهای ذخیره‌شده (نام موجودیت ردیف‌های سجل)، نه برچسب تازه رابط */
const STORED_KEYS = new Set(['پروفایل کاربر', 'صف خطاهای قرنطینه (DLQ)', 'تخصیص مواد BOM پروژه', 'آزادسازی تخصیص BOM', 'فرصت فروش CRM', 'اقدام و تماس CRM']);
/** پیام خطای CSRF که مرورگر آن را از روی متنش می‌شناسد (`src/api.ts`)؛ تغییرش بیرون از این بسته است */
const RECOGNISED_MESSAGES = new Set(['توکن امنیتی CSRF نامعتبر است یا ارسال نشده است']);
/** نشانی IP (ت۸)، نام سامانه، قالب فایل و کد ارز */
const ALLOWED_LATIN = new Set(['IP', 'ERP', 'PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'PDF', 'XLSX', 'IRR', 'USD', 'EUR', 'AED', 'GBP']);
// v10.0.73 (TD-1165): a word boundary is a Persian letter or the zero-width non-joiner, not Persian punctuation
// («لاگ،» used to pass), and JSX text running into `{…}` is scanned too («لاگ امنیتی #{id}» used to pass).
const PERSIAN_LETTER = '[\\u0621-\\u064A\\u067E\\u0686\\u0698\\u06A9\\u06AF\\u06CC\\u200C]';
const TRANSLITERATION = new RegExp(`(?<!${PERSIAN_LETTER})(داشبورد|پروفایل|ماژول|آواتار|سایدبار|لاگ|لاگین|کلاینت|ویزارد|کانبان|اسنپ‌شات|توکن|اکانت)(?!${PERSIAN_LETTER})`);
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*(?=[<{])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** متن بدون `${…}`؛ تکه‌ای که از میانه یک قالب بریده شده هم کنار می‌رود */
function withoutInterpolations(text: string): string {
  let out = text.replace(/\$\{[^{}]*\}/g, ' ').replace(/\$\{[\s\S]*$/, ' ');
  const close = out.indexOf('}');
  if (close >= 0 && !out.slice(0, close).includes('{')) out = out.slice(close + 1);
  return out;
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return;
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const clean = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(clean)) found.push({ line: i + 1, text: clean });
    }
  });
  return found;
}

const files = sourceFiles(SRC).filter(f => PACKAGE_2.some(p => relative(SRC, f).replace(/\\/g, '/').startsWith(p)));
const texts = files.flatMap(f => persianTexts(f).map(t => ({ ...t, where: `${relative(SRC, f)}:${t.line}` })))
  .filter(t => !STORED_KEYS.has(t.text) && !RECOGNISED_MESSAGES.has(t.text));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('package 2 Persian wording (TD-540)', () => {
  it('covers the package files', () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it('has no transliteration in Persian text', () => {
    expect(texts.filter(t => TRANSLITERATION.test(t.text)).map(t => `${t.where}: ${t.text}`)).toEqual([]);
  });

  it('has no English word in Persian text, except the IP address label, the system name, file formats and currency codes', () => {
    const offenders = texts.filter((t) => {
      const words = withoutInterpolations(t.text).replace(/[A-Za-z0-9]*_[A-Za-z0-9_]*/g, ' ').match(/[A-Za-z]{2,}/g) ?? [];
      return words.some(w => !ALLOWED_LATIN.has(w.toUpperCase()));
    });
    expect(offenders.map(t => `${t.where}: ${t.text}`)).toEqual([]);
  });

  it('shows the counts of the users page and the role form in Persian digits', async () => {
    const roles: Role[] = [
      { id: 11, name: 'کارمند فروش', code: 'branch_sales', description: '', permissions: ['customers.view'], isSystem: 0 },
      { id: 12, name: 'مدیر سیستم', code: SYSTEM_ADMIN_ROLE, description: '', permissions: [], isSystem: 1 },
    ];
    const me: User = { id: 1, username: 'root_user', full_name: 'مدیر', role: SYSTEM_ADMIN_ROLE };
    const listed = [me, { id: 2, username: 'sales_user', full_name: 'کاربر فروش', role: 'branch_sales' }];
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/users' ? listed : url === '/roles' ? roles : url === '/permissions' ? PERMISSION_CATALOG : []));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <UsersPage currentUser={me} userPermissions={{ permissions: [], isAdmin: true }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('کاربر فروش')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ماتریس نقش‌ها و مجوزها/ }));
    expect(await screen.findByText('کارمند فروش')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[0-9]/);
    expect(document.body.textContent).not.toContain('RBAC');
    expect(document.body.textContent).not.toContain('code:');
    cleanup();

    render(<RoleFormModal isOpen onClose={() => {}} editingRole={null} permCatalog={PERMISSION_CATALOG as unknown as PermissionCategory[]} onSuccess={() => {}} />);
    const labels = Array.from(document.querySelectorAll('button, option, strong, span')).map(e => e.textContent ?? '');
    expect(labels.filter(text => /[0-9]/.test(text) && !/\(\w+\.\w+\)/.test(text))).toEqual([]);
  });

  it('names a role by its stored name, the system admin by default, and never by its code', () => {
    expect(roleDisplayName('clerk', 'کارمند فروش')).toBe('کارمند فروش');
    expect(roleDisplayName(SYSTEM_ADMIN_ROLE, null)).toBe('مدیر سیستم');
    expect(roleDisplayName('missing_role', null)).toBe('');
  });
});
