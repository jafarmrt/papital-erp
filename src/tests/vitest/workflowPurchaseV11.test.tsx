import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { normalizeSearchText, searchMatches, SEARCH_FOLD_FROM, SEARCH_FOLD_TO } from '../../lib/search/searchText';
import { canIssueLeadProforma, isClosedLead } from '../../lib/crm/leadProformaRule';
import { approvalInboxInstanceLink } from '../../lib/notifications/notificationNotices';
import { REORDER_DIRECT_RECEIPT_PERMISSION } from '../../lib/reorderAlerts/reorderPurchaseReceipt';
import { documentRecordPermission } from '../../lib/permissions/documentPermissions';

// v11 phase 6.3p: one search rule (U8), global search sections (C12), workflow task notices (U6), one requisition form
// (U9), the CRM proforma from any open stage (U17) and the WooCommerce settings of a view-only role (U18).

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => { cleanup(); fetchJson.mockReset(); });

describe('one search fold (U8)', () => {
  it('folds Arabic letters, Persian and Arabic digits, alef forms, teh marbuta and ZWNJ', () => {
    expect([...SEARCH_FOLD_FROM].length).toBe([...SEARCH_FOLD_TO].length);
    expect(normalizeSearchText('علي')).toBe(normalizeSearchText('علی'));
    expect(normalizeSearchText('۰۹۱۲')).toBe('0912');
    expect(normalizeSearchText('٠٩١٢')).toBe('0912');
    expect(normalizeSearchText('آینه')).toBe(normalizeSearchText('اینه'));
    expect(normalizeSearchText('أحمد')).toBe(normalizeSearchText('احمد'));
    expect(normalizeSearchText('می‌رود')).toBe(normalizeSearchText('می رود'));
  });

  it('matches any field and an empty search matches everything', () => {
    expect(searchMatches('', 'x')).toBe(true);
    expect(searchMatches('  ', null)).toBe(true);
    expect(searchMatches('0912', 'مشتری', '۰۹۱۲۳۴۵۶۷۸۹')).toBe(true);
    expect(searchMatches('كيف', 'کیف چرمی')).toBe(true);
    expect(searchMatches('آینه', 'اینه گرد')).toBe(true);
    expect(searchMatches('ABC', 'abc-1')).toBe(true);
    expect(searchMatches('ساعت', 'کیف', undefined, 12)).toBe(false);
  });
});

// Files that search outside the fold on purpose: code series prefixes, technical event ids, the trigram-indexed activity
// log (TD-1324), a fixed health check literal and the browser Excel column matching
const SERVER_ALLOW = new Set([
  'services/items/itemCatalog.service.ts',
  'services/events/eventSourcingReplayService.ts',
  'services/events/deadLetterQueueService.ts',
  'services/events/outboxSearch.ts',
  'services/system/activityLogQuery.service.ts',
  'services/accounting/financialHealth.service.ts',
  'services/piecework/taskCode.ts',
]);
const CLIENT_ALLOW = new Set(['components/excel/excelImportValidation.ts']);
const FOLD_HELPERS = /foldedSearchSql|compactFoldedSearchSql|foldedContains|foldedLike|phoneMatchKeySql|matchesAny\(/;
const SRC = join(__dirname, '..', '..');

/** the code of a file without its comments, so a comment that names ILIKE is not a search */
const codeOf = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every list search goes through the fold (U8 guard)', () => {
  it('has no raw ILIKE search on the server, and every contains pattern sits beside a fold', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(SRC, 'services')), ...sourceFiles(join(SRC, 'routes'))]) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (SERVER_ALLOW.has(rel)) continue;
      const text = codeOf(readFileSync(file, 'utf8'));
      if (/\bilike\(|\bILIKE\b/.test(text)) offenders.push(`${rel}: ILIKE`);
      if (text.includes('containsLikePattern(') && !FOLD_HELPERS.test(text)) offenders.push(`${rel}: contains pattern without the fold`);
    }
    expect(offenders).toEqual([]);
  });

  it('has no lower-case includes filter in the screens', () => {
    const offenders: string[] = [];
    for (const dir of ['components', 'pages', 'hooks']) {
      for (const file of sourceFiles(join(SRC, dir))) {
        const rel = relative(SRC, file).replace(/\\/g, '/');
        if (CLIENT_ALLOW.has(rel)) continue;
        if (codeOf(readFileSync(file, 'utf8')).includes('.toLowerCase().includes(')) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('global search reports a failed section (C12)', () => {
  it('says which section failed instead of «nothing found»', async () => {
    fetchJson.mockResolvedValue({ items: [], customers: [], documents: [], projects: [], failedSections: ['documents'] });
    const GlobalHeaderSearch = (await import('../../components/GlobalHeaderSearch')).default;
    const { SearchProvider } = await import('../../SearchContext');
    render(
      <SearchProvider>
        <MemoryRouter>
          <GlobalHeaderSearch />
        </MemoryRouter>
      </SearchProvider>,
    );
    const input = screen.getByPlaceholderText(/جست‌وجوی سراسری/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'فاکتور ۱۲' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('اسناد و فاکتورها');
    expect(screen.queryByText(/یافت نشد/)).toBeNull();
  });
});

describe('a workflow task notice opens its own task (U6)', () => {
  it('links the inbox with the instance', () => {
    expect(approvalInboxInstanceLink(42)).toBe('/approval-inbox?instance=42');
  });
});

describe('a proforma from any open lead (U17)', () => {
  it('allows every open stage once, never a closed lead', () => {
    for (const stage of ['lead', 'qualified', 'proposal']) {
      expect(canIssueLeadProforma({ stage, status: 'active', hasProforma: 0 })).toBe(true);
    }
    expect(canIssueLeadProforma({ stage: 'lead', status: 'active', hasProforma: 1 })).toBe(false);
    expect(canIssueLeadProforma({ stage: 'won', status: 'won' })).toBe(false);
    expect(canIssueLeadProforma({ stage: 'proposal', status: 'lost' })).toBe(false);
    expect(isClosedLead({ stage: 'lost' })).toBe(true);
  });
});

describe('the direct receipt of the reorder page (U9)', () => {
  it('asks the key the server asks of a final receipt', () => {
    expect(REORDER_DIRECT_RECEIPT_PERMISSION).toBe(documentRecordPermission('receipt', 'final', 'in'));
  });
});
