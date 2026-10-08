import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// v9.0.20 (TD-432، تصمیم مالک محصول ت۷ و تصمیم فاز ۲ درباره آوانویسی): در متن فارسی رابط «CRM» نمی‌آید و «ارتباط با مشتری»
// جای آن است؛ در فایل‌های بسته ۹ «تسک»، «لید»، «منشن» و «کانبان» هم نمی‌آیند (پیگیری، پرونده فروش، اشاره، قیف فروش)

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

/** کلیدهای ذخیره‌شده، نه برچسب رابط: نام موجودیت ردیف‌های قدیمی لاگ ممیزی و نام حساب ۷۰۰۶ کدینگ استاندارد */
const STORED_KEYS = new Set(['فرصت فروش CRM', 'اقدام و تماس CRM', 'هزینه تبلیغات، بازاریابی و CRM']);

const PACKAGE_9 = [
  'components/crm/', 'components/customers/', 'components/dashboard/CRMTasksWidget.tsx', 'hooks/useCRMData.ts',
  'hooks/useCRMFilters.ts', 'hooks/useCrmFollowups.ts', 'hooks/queries/useCustomerQueries.ts', 'lib/crm/', 'lib/customers/',
  'pages/CRMPage.tsx', 'pages/CustomersPage.tsx', 'routes/crm.routes.ts', 'routes/customers.routes.ts',
  'services/customer.service.ts', 'services/crm/', 'services/customers/', 'types/crm.types.ts',
];
const TRANSLITERATION = /(?<![؀-ۿ])(تسک|لید|منشن|کانبان)|Kanban/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(ROOT, path).replace(/\\/g, '/');
    if (rel === 'tests' || rel === 'data/changelogs') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    // متن JSX در خط خودش (بی برچسب در همان خط)
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) if (PERSIAN.test(text)) found.push({ line: i + 1, text: text.replace(/^[>'"`]|[<'"`]$/g, '') });
  });
  return found;
}

const files = sourceFiles(ROOT);

describe('CRM wording in the Persian UI (TD-432)', () => {
  it('uses "customer relations" (the Persian term) instead of "CRM" in Persian UI text', () => {
    const offenders = files.flatMap(f => persianTexts(f)
      .filter(t => t.text.includes('CRM') && !STORED_KEYS.has(t.text))
      .map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('has no transliterated "task", "lead", "mention" or "kanban" in package 9 text', () => {
    const offenders = files
      .filter(f => PACKAGE_9.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)))
      .flatMap(f => persianTexts(f).filter(t => TRANSLITERATION.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });
});
