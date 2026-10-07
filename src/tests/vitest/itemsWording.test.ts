import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEGACY_WAC_COLUMNS, NON_PRICE_LIST_TITLES } from '../../lib/items/excelPriceColumns';
import { LEGACY_REORDER_POINT_COLUMNS } from '../../lib/items/itemExcelColumns';

// Package 5 (TD-664 / B05-18, decision t10 item 1): Persian text of the item, Excel import and pricing UI and of the item
// server messages has no English word («WAC», «Template») and none of the replaced transliterations; «کاردکس» and
// «ترنسفر» stay (workshop terms), and «اکسل» and «ووکامرس» are product names.

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

const ITEM_UI = [
  'components/items/', 'components/excel/', 'components/pricing/', 'components/UnifiedExcelModal.tsx',
  'components/settings/CategoriesTab.tsx', 'components/settings/PricingStrategiesTab.tsx',
  'pages/ItemsPage.tsx', 'pages/PricingPage.tsx', 'pages/GalleryPage.tsx', 'lib/items/',
  'services/items/', 'services/items.service.ts', 'routes/items.crud.routes.ts', 'routes/items.import.routes.ts',
  'routes/items.prices.routes.ts', 'routes/items.schemas.ts', 'routes/categories.routes.ts',
];
/** the B05-18 table and the warehouse glossary (TD-496): replaced transliterations and the old cost wording */
const REPLACED = /بروزرسانی|استراتژی|کدینگ|کتگوری|اتمیک|آلارم|ایمپورت|دیتابیس|فرمولاسیون|کاتالوگ|آپلود|فرمت|لیست|آرشیو|میانگین بهای خرید|بهای میانگین/;
/** a Latin word inside Persian text, except a file extension */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
/** currency codes the price forms show, and debt ids in financial health check details */
const PROPER_ACRONYMS = new Set(['IRR', 'USD', 'EUR', 'AED', 'GBP', 'TD']);
/** old Excel headers and price titles the server and the shared column lists still recognise; data, not UI text */
const LEGACY_DATA_FILES = ['lib/items/', 'services/', 'routes/'];
const LEGACY_NAMES = new Set<string>([...LEGACY_WAC_COLUMNS, ...NON_PRICE_LIST_TITLES, ...LEGACY_REORDER_POINT_COLUMNS]);
const hasEnglishWord = (text: string) => (text.match(LATIN_WORD) ?? []).some(w => !PROPER_ACRONYMS.has(w));

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
  line = line.replace(/\s\/\/\s.*$/, '');
  while (/\$\{[^{}]*\}/.test(line)) line = line.replace(/\$\{[^{}]*\}/g, '');
  return line;
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  const legacyAllowed = LEGACY_DATA_FILES.some(p => relative(ROOT, file).replace(/\\/g, '/').startsWith(p));
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = codeLine(raw);
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const shown = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(shown) && !(legacyAllowed && LEGACY_NAMES.has(shown))) found.push({ line: i + 1, text: shown });
    }
  });
  return found;
}

/** every Persian code line, also JSX text next to expressions such as «میانگین بهای خرید {arrow}»; legacy data names removed */
function persianLines(file: string): Array<{ line: number; text: string }> {
  const legacyAllowed = LEGACY_DATA_FILES.some(p => relative(ROOT, file).replace(/\\/g, '/').startsWith(p));
  return readFileSync(file, 'utf8').split('\n').map((raw, i) => {
    let text = codeLine(raw);
    if (legacyAllowed) for (const name of LEGACY_NAMES) text = text.split(`'${name}'`).join("''");
    return { line: i + 1, text };
  }).filter(t => PERSIAN.test(t.text));
}

const files = sourceFiles(ROOT).filter(f => ITEM_UI.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)));

describe('Item and pricing UI wording (TD-664)', () => {
  it('reads the item UI and server files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no English words in Persian item text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => hasEnglishWord(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('uses the decided words, not the replaced ones', () => {
    const offenders = files.flatMap(f => persianLines(f).filter(t => REPLACED.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });
});
