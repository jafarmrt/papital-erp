import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import ts from 'typescript';
import * as xlsx from 'xlsx';
import type { PersonnelFormData } from '../../hooks/usePersonnel';
import type { Personnel } from '../../types';

/**
 * Closing sweep, piecework and personnel observations of package 12 (OBS-R1-40, OBS-R2-51, OBS-R2-53, OBS-R2-55 and the
 * statutory remittance review nit). Each test is red on the code before its fix.
 */

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const fetchJson = vi.fn<(url: string, opts?: FetchOpts) => Promise<unknown>>();
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: false, canIssuePayroll: false, canPay: true }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(k => granted.has(k)),
}));
let personnelHook: Record<string, unknown> = {};
vi.mock('../../hooks/usePersonnel', () => ({ usePersonnel: () => personnelHook }));

import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';
import { StatutoryRemittanceModal } from '../../components/piecework/StatutoryRemittanceModal';
import { PersonnelExcelModal } from '../../components/personnel/PersonnelExcelModal';
import { PersonnelFormModal } from '../../components/personnel/PersonnelFormModal';
import { PersonnelPage } from '../../pages/PersonnelPage';
import { STATUTORY_UNASSIGNED_ACK_LABEL, type StatutoryRemittanceOptions } from '../../lib/treasury/statutoryRemittance';

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  granted.clear();
  personnelHook = {};
});

const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The text of every comment of a source file, from the parsed tree (so a «//» inside a string or template is no comment) */
function commentsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const seen = new Map<number, string>();
  const collect = (pos: number, end: number) => { seen.set(pos, text.slice(pos, end)); };
  const visit = (node: ts.Node) => {
    ts.forEachLeadingCommentRange(text, node.pos, collect);
    ts.forEachTrailingCommentRange(text, node.end, collect);
    ts.forEachChild(node, visit);
  };
  visit(source);
  ts.forEachLeadingCommentRange(text, source.endOfFileToken.pos, collect);
  return [...seen.values()];
}

// UTF-8 Persian read as Windows-1252: a lead byte Ø Ù Ú Û (or Ã) followed by a continuation byte 0x80-0xBF as cp1252 shows it
const MOJIBAKE = /[ÃØÙÚÛ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/;

/** a correctly encoded Persian comment, which the check must accept */
const CLEAN_PERSIAN_COMMENT = '// هدایت خطا به errorHandler';

/** the server's 409 message for earlier payments without a personnel name */
const UNASSIGNED_REFUSAL = 'پیش‌تر بی نام پرسنل پرداخت شده است.';

/** any Persian letter: the label shown for the stored salary model */
const PERSIAN_LETTERS = /[\u0600-\u06FF]/;

describe('no mojibake in source comments (OBS-R1-40)', () => {
  it('no comment under src/ holds UTF-8 Persian decoded as Windows-1252', () => {
    expect(MOJIBAKE.test('// V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§')).toBe(true);
    expect(MOJIBAKE.test(CLEAN_PERSIAN_COMMENT)).toBe(false);
    expect(commentsOf(path.join(SRC, 'routes/piecework.routes.ts')).length).toBeGreaterThan(10);
    // only a file whose text holds the marker at all is parsed for its comments
    const offenders = sourceFiles(SRC)
      .filter(file => MOJIBAKE.test(readFileSync(file, 'utf8')) && commentsOf(file).some(c => MOJIBAKE.test(c)))
      .map(file => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});

describe('payroll form details (OBS-R2-51)', () => {
  it('opening the payslip form clears the advance deduction of the previous payslip', () => {
    const hook = read('hooks/usePiecework.ts');
    const open = hook.slice(hook.indexOf('const handleOpenPayrollModal'), hook.indexOf('setIsPayrollModalOpen(true)'));
    expect(open).toContain('setPayrollAdvanceDeduction(0)');
  });

  it('the payroll payment window offers only rial treasury accounts', async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url === '/accounting/bank-accounts/options') {
        return [
          { id: 3, code: 'B-3', title: 'صندوق ریالی', type: 'cash', bankName: null, currency: 'IRR', hasLedgerAccount: true },
          { id: 4, code: 'B-4', title: 'حساب دلاری', type: 'bank', bankName: null, currency: 'USD', hasLedgerAccount: true },
        ];
      }
      return [];
    });
    render(<PayrollPaymentModal payroll={{ id: 7, payrollNumber: 'PAY-7', netPayable: 900000, paidAmount: 0, status: 'approved' }} onClose={vi.fn()} />);
    await screen.findByText('صندوق ریالی');
    expect(screen.queryByText('حساب دلاری')).toBeNull();
    const bankSelect = screen.getAllByRole('combobox').find(el => el.querySelector('option[value="3"]'));
    expect(bankSelect?.querySelector('option[value="4"]')).toBeNull();
  });
});

const xlsxFile = (rows: Array<Record<string, string>>): File => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'rows');
  const data = xlsx.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([data], 'personnel.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

describe('personnel Excel import (OBS-R2-53)', () => {
  it('sends only the rows without an error and never invents a name', async () => {
    const posted: Array<{ rows: Array<Record<string, unknown>> }> = [];
    fetchJson.mockImplementation(async (url: string, opts?: FetchOpts) => {
      if (url === '/personnel/bulk-import' && opts?.method === 'POST') {
        posted.push(JSON.parse(opts.body ?? '{}') as { rows: Array<Record<string, unknown>> });
        return { createdCount: 1, updatedCount: 0, errors: [], warnings: [] };
      }
      return {};
    });
    const { container } = render(<PersonnelExcelModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} existingPersonnel={[]} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [xlsxFile([
      { 'نام و نام خانوادگی': 'کارگر درست', 'کد پرسنلی': 'P-1' },
      { 'نام و نام خانوادگی': '', 'کد پرسنلی': 'P-2' },
      { 'نام و نام خانوادگی': 'کد تکراری', 'کد پرسنلی': 'P-1' },
    ])] } });
    const confirm = await screen.findByRole('button', { name: /تایید و ثبت نهایی/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(posted).toHaveLength(1));
    const sent = posted[0].rows;
    expect(sent.map(r => r.fullName)).toEqual(['کارگر درست']);
    expect(sent.some(r => r.fullName === '---')).toBe(false);
  });
});

const PERSON = { id: 7, firstName: 'علی', lastName: 'رضایی', fullName: 'علی رضایی', personnelCode: 'P-7', employmentStatus: 'فعال' } as unknown as Personnel;

function personnelPageHook(): Record<string, unknown> {
  return {
    personnelList: [PERSON], usersList: [], isLoading: false, searchQuery: '', setSearchQuery: vi.fn(), statusFilter: 'all',
    setStatusFilter: vi.fn(), resetFilters: vi.fn(), currentPage: 1, setCurrentPage: vi.fn(), pageSize: 10, setPageSize: vi.fn(),
    totalPages: 1, totalFilteredCount: 1, totalAllCount: 1, startIndex: 0, endIndex: 1, paginatedPersonnel: [PERSON],
    showFormModal: false, setShowFormModal: vi.fn(), editingId: null, showDetailModal: true, setShowDetailModal: vi.fn(),
    selectedPersonnel: PERSON, isSaving: false, formData: {}, setFormData: vi.fn(), loadData: vi.fn(), handleOpenAddModal: vi.fn(),
    handleOpenEditModal: vi.fn(), handleSave: vi.fn(), handleDelete: vi.fn(), handleViewDetail: vi.fn(),
    stats: { total: 1, active: 1, terminated: 0, onLeave: 0, usersCount: 0 },
  };
}

const rowMenuLabels = async (): Promise<string[]> => {
  const table = screen.getByRole('table');
  fireEvent.click(within(table).getByTitle('عملیات بیشتر'));
  return within(screen.getByRole('menu')).getAllByRole('button').map(el => el.textContent ?? '');
};

describe('personnel page buttons and form (OBS-R2-55)', () => {
  it('a reader without personnel.manage sees no create, Excel, edit or delete button', async () => {
    personnelHook = personnelPageHook();
    granted.add('personnel.view');
    render(<PersonnelPage />);
    expect(screen.queryByText('ثبت پرسنل جدید')).toBeNull();
    expect(screen.queryByText('ورود و خروجی اکسل')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ویرایش' })).toBeNull();
    const labels = await rowMenuLabels();
    expect(labels.some(l => l.includes('ویرایش مشخصات'))).toBe(false);
    expect(labels.some(l => l.includes('حذف پرسنل'))).toBe(false);
  });

  it('a holder of personnel.manage sees them all', async () => {
    personnelHook = personnelPageHook();
    granted.add('personnel.manage');
    render(<PersonnelPage />);
    expect(screen.getByText('ثبت پرسنل جدید')).toBeTruthy();
    expect(screen.getByText('ورود و خروجی اکسل')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ویرایش' })).toBeTruthy();
    const labels = await rowMenuLabels();
    expect(labels.some(l => l.includes('ویرایش مشخصات'))).toBe(true);
    expect(labels.some(l => l.includes('حذف پرسنل'))).toBe(true);
  });

  it('a stored salary model none keeps its value and is shown with a Persian label', () => {
    const formData = new Proxy({ salaryType: 'none' } as Record<string, unknown>, {
      get: (target, key) => (typeof key === 'string' && !(key in target) ? '' : target[key as string]),
    }) as unknown as PersonnelFormData;
    render(<PersonnelFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} editingId={7} formData={formData}
      setFormData={vi.fn()} usersList={[]} isSaving={false} />);
    const select = screen.getByLabelText('مدل حقوق') as HTMLSelectElement;
    expect(select.value).toBe('none');
    const shown = select.options[select.selectedIndex]?.textContent ?? '';
    expect(shown).not.toMatch(/none/i);
    expect(shown).toMatch(PERSIAN_LETTERS);
  });

  it('a refused save stays in the form and does not leave its rejection unhandled', () => {
    const hook = read('hooks/usePersonnel.ts');
    const save = hook.slice(hook.indexOf('saveMutation.mutateAsync'), hook.indexOf('setShowFormModal(false);\n    resetForm();'));
    expect(save).toMatch(/\.then\(\s*\(\)\s*=>\s*true,\s*\(\)\s*=>\s*false\s*\)/);
    expect(hook).not.toMatch(/\n\s*await saveMutation\.mutateAsync\(/);
  });
});

const NAMED_VOUCHER = '2091';
const remittanceOptions: StatutoryRemittanceOptions = {
  kind: 'insurance', jalaliYear: 1405, jalaliMonth: 1, accountCode: '3204', accountName: 'بیمه پرداختنی',
  rows: [{ personnelId: 1, fullName: 'کارگر بیمه‌شده', personnelCode: 'P1', monthAmount: '6000000', remitted: '0', balance: '6000000', suggested: '6000000' }],
  totals: { monthAmount: '6000000', remitted: '0', suggested: '6000000' },
  unassignedPayments: { amount: '0', vouchers: [] },
};

describe('statutory remittance window (review nit)', () => {
  it('shows the payments without a personnel name that the server names in its 409 and asks for the acknowledgement again', async () => {
    let posts = 0;
    fetchJson.mockImplementation(async (url: string, opts?: FetchOpts) => {
      if (opts?.method === 'POST') {
        posts += 1;
        throw Object.assign(new Error(UNASSIGNED_REFUSAL), {
          code: 'STATUTORY_REMITTANCE_UNASSIGNED_PAYMENTS', status: 409,
          details: { unassignedPayments: { amount: '500000', vouchers: [{ voucherId: 9, voucherNumber: NAMED_VOUCHER, date: '2026-04-11', amount: '500000' }] } },
        });
      }
      if (url.startsWith('/accounting/treasury/statutory-remittance/options')) return remittanceOptions;
      if (url === '/accounting/bank-accounts/options') return [{ id: 5, code: 'B1', title: 'بانک کارگاه', type: 'bank', bankName: null, currency: 'IRR', hasLedgerAccount: true }];
      return [];
    });
    const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
    render(wrap(<StatutoryRemittanceModal kind="insurance" jalaliYear={1405} jalaliMonth={1} onClose={vi.fn()} />));
    const bank = await screen.findByLabelText(/حساب بانکی یا صندوق/) as HTMLSelectElement;
    await waitFor(() => expect(bank.options.length).toBe(2));
    fireEvent.change(bank, { target: { value: '5' } });
    const submit = screen.getByRole('button', { name: 'ثبت پرداخت با سند حسابداری' }) as HTMLButtonElement;
    expect(screen.queryByLabelText(STATUTORY_UNASSIGNED_ACK_LABEL)).toBeNull();
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toBe(1));
    expect(await screen.findByText(/سند ۲۰۹۱/)).toBeTruthy();
    expect((screen.getByLabelText(STATUTORY_UNASSIGNED_ACK_LABEL) as HTMLInputElement).checked).toBe(false);
    expect(submit.disabled).toBe(true);
  });
});
