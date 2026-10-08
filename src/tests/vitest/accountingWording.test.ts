import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Package 3 (TD-579 / B03-37, owner glossary of package 16 and the package 2 wording rule): Persian text of the
// accounting UI has no English word and none of the replaced loanwords; the voucher form does not call a draft save
// «ثبت قطعی». Treasury and cheque screens have their own wording test (package 4).

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

const ACCOUNTING_UI = [
  'pages/AccountingPage.tsx', 'components/accounting/', 'components/settings/AccountingSettingsTab.tsx',
  'components/settings/ChartOfAccountsSettingsTab.tsx', 'lib/accounting/', 'hooks/accounting/', 'hooks/useAccounting.ts',
];
const OTHER_PACKAGE = /components\/accounting\/(?:treasury|reconciliation)\/|ChequesTab\.tsx$|BankAndTreasuryTab\.tsx$/;

/** B03-37: dashboard, double entry, article, workflow, mapping, automatic, switch, chart, keyboard, scan, tab, «جستجو» */
const REPLACED = /داشبورد|دوبل|آرتیکل|ورکفلو|مپینگ|اتوماتیک|اتوماسیون|سوییچ|چارت|کیبورد|اسکن|جستجو|(?:^|[\s«(])تب(?:[\s»)،.]|$)/;
/** a Latin word inside Persian text, except a file extension, a key name, a file format or a currency code */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
const ALLOWED_LATIN = new Set(['Ctrl', 'Alt', 'Shift', 'Enter', 'Esc', 'Delete', 'Insert', 'Space', 'Tab', 'CSV', 'PDF', 'IRR', 'USD', 'EUR', 'AED', 'GBP', 'IP']);
const englishWords = (text: string) => (text.match(LATIN_WORD) ?? []).filter(w => !ALLOWED_LATIN.has(w));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** a source line without comments and without the code placed inside template literals (nested ones included) */
function codeLine(raw: string): string {
  let line = raw.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return '';
  // comparisons and arrows are code, not the edges of JSX text
  line = line.replace(/\s\/\/\s.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/\s[<>]=?\s|=>/g, ' ');
  while (/\$\{[^{}]*\}/.test(line)) line = line.replace(/\$\{[^{}]*\}/g, '');
  return line;
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = codeLine(raw);
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const shown = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(shown)) found.push({ line: i + 1, text: shown });
    }
  });
  return found;
}

function persianLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, 'utf8').split('\n').map((raw, i) => ({ line: i + 1, text: codeLine(raw) })).filter(t => PERSIAN.test(t.text));
}

const files = sourceFiles(ROOT).filter((f) => {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  return ACCOUNTING_UI.some(p => rel.startsWith(p)) && !OTHER_PACKAGE.test(rel);
});

describe('Accounting UI wording (TD-579)', () => {
  it('reads the accounting UI files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no English words in Persian accounting UI text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => englishWords(t.text).length > 0).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('uses the decided words, not the replaced ones', () => {
    const offenders = files.flatMap(f => persianLines(f).filter(t => REPLACED.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('does not call the voucher form save, which stores a draft, a final registration', () => {
    const form = readFileSync(join(ROOT, 'components/accounting/NewVoucherModal.tsx'), 'utf8');
    expect(form).not.toMatch(/ثبت قطعی/);
  });
});
