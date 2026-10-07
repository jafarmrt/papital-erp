import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// v9.0.252 (TD-646، تصمیم مالک محصول ت۶): متن فارسی گزارش کار روزانه «اشاره» و «اعلان» می‌گوید، نه «منشن» و «نوتیفیکیشن»،
// و مجوز را با نام فارسی‌اش می‌آورد، نه با کلید انگلیسی

const ROOT = join(__dirname, '..', '..');
const PACKAGE_13 = [
  'components/daily-logs/', 'components/MentionTextarea.tsx', 'components/dashboard/DailyLogsMentionsWidget.tsx',
  'hooks/useDailyLogs.ts', 'hooks/useDailyLogFocus.ts', 'hooks/useDashboardDailyLogs.ts', 'lib/dailyLogs/',
  'pages/DailyLogsPage.tsx', 'routes/dailyLogs.routes.ts', 'routes/dailyLogs.schemas.ts', 'services/dailyLogs/',
];
const TRANSLITERATION = /منشن|نوتیفیکیشن|نوتیف/;
const PERSIAN = /[؀-ۿ]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function codeLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, 'utf8').split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({ text }) => !text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*') && !text.startsWith('{/*'));
}

const packageFiles = files(ROOT).filter((f) => {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  return PACKAGE_13.some(p => rel.startsWith(p));
});

describe('daily log wording in the Persian UI (TD-646)', () => {
  it('covers the package 13 files', () => {
    expect(packageFiles.length).toBeGreaterThan(10);
  });

  it('uses the Persian words for mention and notification, never their transliterations', () => {
    const offenders = packageFiles.flatMap(f => codeLines(f)
      .filter(l => TRANSLITERATION.test(l.text))
      .map(l => `${relative(ROOT, f)}:${l.line}: ${l.text}`));
    expect(offenders).toEqual([]);
  });

  it('names a permission in Persian text by its Persian title, never by its key', () => {
    const offenders = packageFiles.flatMap(f => codeLines(f)
      .filter(l => PERSIAN.test(l.text) && /daily_logs\.[a-z_]+/.test(l.text))
      .map(l => `${relative(ROOT, f)}:${l.line}: ${l.text}`));
    expect(offenders).toEqual([]);
  });
});
