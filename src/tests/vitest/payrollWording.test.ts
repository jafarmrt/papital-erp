import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// v9.0.323 (TD-815, B12P-12, owner decision t6): one word for one idea. Persian UI and server text says «کارمزدی», never
// «پرکیسی»; print buttons say «چاپ», not «پرینت»; piecework screens have no «Template» and messages carry no raw status code.

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

/** Stored keys, not UI labels: audit entity names of existing log rows and the seeded names of accounts 3201 and 6002 */
const STORED_KEYS = [
  'کارکرد پرکیسی', 'عنوان پرکیسی', 'عناوین پرکیسی',
  'حقوق و دستمزد پرداختنی پرسنل (پرکیسی/کنتراتی)', 'دستمزد مستقیم تولید (کارمزد پرکیسی و قطعه‌کاری)',
];

const PAYROLL_FILES = [
  'components/piecework/', 'components/personnel/PersonnelFormModal.tsx', 'hooks/usePiecework.ts', 'lib/payroll/', 'lib/piecework/',
  'pages/MyPayslipsPage.tsx', 'pages/PieceworkPayrollPage.tsx', 'routes/piecework.routes.ts', 'services/piecework/',
];
const FOREIGN_WORDS = /پرینت|Template|\((?:draft|approved|partially_paid|paid)\)/;

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
    // JSX text on a line of its own
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) if (PERSIAN.test(text)) found.push({ line: i + 1, text });
  });
  return found;
}

const withoutStoredKeys = (text: string) => STORED_KEYS.reduce((rest, key) => rest.split(key).join(''), text);
const files = sourceFiles(ROOT);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

describe('payroll wording (TD-815)', () => {
  it('uses the chosen piecework word in Persian text, except stored keys', () => {
    const offenders = files.flatMap(f => persianTexts(f)
      .filter(t => withoutStoredKeys(t.text).includes('پرکیسی'))
      .map(t => `${rel(f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('has no transliterated print word, English template word or raw status code in payroll text', () => {
    const offenders = files
      .filter(f => PAYROLL_FILES.some(p => rel(f).startsWith(p)))
      .flatMap(f => persianTexts(f).filter(t => FOREIGN_WORDS.test(t.text)).map(t => `${rel(f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });
});
