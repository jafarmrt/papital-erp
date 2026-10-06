import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Package 6 (TD-496 / B06-17, decision t6 and the package 16 glossary t7): Persian text of the warehouse and Kardex UI
// has no English word («WAC») and none of the replaced words; only «کاردکس» and «ترنسفر» stay transliterated.

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

const INVENTORY_UI = [
  'components/inventory/', 'components/RunningKardexModal.tsx', 'pages/InventoryStatusPage.tsx', 'pages/InventoryAuditPage.tsx',
  'pages/TransactionsPage.tsx', 'hooks/inventoryAudit/', 'hooks/transactions/', 'lib/inventoryAudit/',
];
/** decision t6 and glossary t7: dashboard, alarm, material, database, filter, misspelt Kardex, «بروزرسانی», book stock */
const REPLACED = /داشبورد|آلارم|متریال|بانک اطلاعاتی|فیلتر|کارتکس|بروزرسانی|موجودی سیستمی|موجودی اسمی|کسری سیستمی|میانگین بهای خرید/;
/** a Latin word inside Persian text, except a file extension */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
const PROPER_ACRONYMS = new Set<string>();
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

/** every Persian code line, also JSX text next to expressions such as «+{diff} (کسری سیستمی)» */
function persianLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, 'utf8').split('\n').map((raw, i) => ({ line: i + 1, text: codeLine(raw) })).filter(t => PERSIAN.test(t.text));
}

const files = sourceFiles(ROOT).filter(f => INVENTORY_UI.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)));

describe('Warehouse and Kardex UI wording (TD-496)', () => {
  it('reads the warehouse UI files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no English words in Persian warehouse UI text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => hasEnglishWord(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('uses the decided words, not the replaced ones', () => {
    const offenders = files.flatMap(f => persianLines(f).filter(t => REPLACED.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('asks for confirmation with the Persian dialog, never the browser prompt', () => {
    const offenders = files.filter(f => /window\.confirm\(/.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
