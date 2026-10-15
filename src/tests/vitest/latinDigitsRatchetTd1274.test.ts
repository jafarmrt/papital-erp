// @vitest-environment node
/**
 * v10.1.23 (TD-1274, Vibe Farsi audit item 2): a number a screen shows is written in Persian digits. The ratchet in
 * scripts/latin-digits-ratchet.ts asks the TypeScript checker which shown values are numbers (JSX children, template
 * literals and text attributes) against latin-digits-baseline.json, which is empty: no page or component may show one.
 */
import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  compareWithBaseline,
  countsOf,
  repositorySites,
  sitesOfSource,
  type Baseline,
  type Site,
} from '../../../scripts/latin-digits-ratchet';

const PROBE = `
declare function formatPersianNumber(v: number): string;
const items: string[] = [];
const page: number = 3;
const total: number | undefined = 10;
const label: string = 'a';
const size = 2048;
export const probe = (
  <div title={\`\${items.length} items\`} aria-label={label}>
    <span>{items.length}</span>
    <span>{page > 1 ? page : '-'}</span>
    <span>{label || total}</span>
    <span>{formatPersianNumber(page)}</span>
    <span>{\`page \${page} of \${label}\`}</span>
    <span>{(size / 1024).toFixed(1)}</span>
    <span>{label}</span>
    <span key={page} className={\`w-\${page}\`}>{items.map((x, i) => <b key={x}>{i + 1}</b>)}</span>
  </div>
);
`;

// both scans build a TypeScript program (the repository one type-checks every page), so each runs once per file run
let probeSites: Site[] = [];
let repoSites: Site[] = [];
beforeAll(() => {
  probeSites = sitesOfSource(PROBE);
  repoSites = repositorySites();
}, 180_000);

describe('latin_digits_ratchet_td_1274', () => {
  it('counts shown numbers by their type, through conditionals, templates, toFixed and map callbacks', () => {
    expect(probeSites.map(site => site.text)).toEqual([
      'items.length', // title template
      'items.length',
      'page',
      'total',
      'page', // template child
      '(size / 1024).toFixed(1)',
      'i + 1',
    ]);
  });

  it('leaves formatted values, strings, keys and class names alone', () => {
    const texts = probeSites.map(site => site.text);
    expect(texts).not.toContain('formatPersianNumber(page)');
    expect(texts).not.toContain('label');
    expect(probeSites.filter(site => site.text === 'page')).toHaveLength(2);
  });

  it('fails when a file gains a site and reports a decrease separately', () => {
    const baseline: Baseline = { 'a.tsx': 1 };
    expect(compareWithBaseline({ 'a.tsx': 2 }, baseline).increased).toEqual(['a.tsx: 1 -> 2']);
    expect(compareWithBaseline({ 'a.tsx': 1, 'b.tsx': 1 }, baseline).increased).toEqual(['b.tsx: 0 -> 1']);
    expect(compareWithBaseline({}, baseline).decreased).toEqual(['a.tsx: 1 -> 0']);
  });

  it('the pages and components match the committed baseline, which is empty', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), BASELINE_FILE), 'utf8')) as Baseline;
    expect(baseline).toEqual({});
    const current = countsOf(repoSites);
    expect(repoSites.map(site => `${site.file}:${site.line} ${site.text}`)).toEqual([]);
    expect(compareWithBaseline(current, baseline)).toEqual({ increased: [], decreased: [] });
  });

  it('the screens the audit named show Persian digits', () => {
    const files = new Set(repoSites.map(site => site.file));
    for (const file of [
      'src/components/crm/CustomerDossierDrawer.tsx',
      'src/pages/CustomersPage.tsx',
      'src/pages/GalleryPage.tsx',
      'src/components/documents/DocItemsTable.tsx',
      'src/components/inventory/InventoryDocumentDetailModals.tsx',
      'src/components/WarehouseTransferModal.tsx',
      'src/components/piecework/PieceworkRateHistoryModal.tsx',
      'src/components/accounting/FinancialAttachmentViewerModal.tsx',
    ]) expect(files.has(file), file).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/__latin_digits_probe__.tsx'))).toBe(false);
  });
});
