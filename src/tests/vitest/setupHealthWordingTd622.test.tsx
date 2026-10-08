import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn().mockResolvedValue(false) }));

import SystemHealthDiagnostic from '../../components/SystemHealthDiagnostic';
import SetupPage from '../../pages/SetupPage';
import { ClearDataModal } from '../../components/settings/SystemOperationsTab';

// v9.0.392 (TD-622, B01-42, decision t8): the setup wizard, the health page and the factory reset dialog show no English
// word or Latin digit; an environment variable name or a path appears only as code or technical detail. On v9.0.391 the
// health page showed «PostgreSQL», «ms», «RAM Heap», «MB», «Node.js» and 13 numbers in Latin digits, the wizard showed
// «ERP_SETUP_TOKEN», «ERP پاپیتال», «02188888888» and the default company «سامانه جامع ERP پاپیتال», and the reset
// asked for «DELETE».

afterEach(() => { cleanup(); fetchJsonMock.mockReset(); });

const latinRuns = (text: string) => Array.from(new Set(text.match(/[A-Za-z][A-Za-z.]*/g) || []));
const latinDigitRuns = (text: string) => Array.from(new Set(text.match(/[^\s]*[0-9][^\s]*/g) || []));

/** What the user reads: text without code and technical details */
function visibleText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('code, [data-technical]').forEach(el => el.remove());
  return copy.textContent || '';
}

const placeholders = (root: HTMLElement) => Array.from(root.querySelectorAll('input')).map(i => i.placeholder).join(' | ');

const health = {
  database: { status: 'ok', latencyMs: 12, message: 'پایگاه‌داده متصل و آماده است.' },
  storage: {
    status: 'ok', writable: true, message: 'پوشه‌های پیوست‌ها و تصویرها قابل نوشتن‌اند.',
    locations: [{ kind: 'attachments', path: '/srv/erp/public/uploads/.attachments', writable: true, message: 'پوشه پیوست‌ها قابل نوشتن است.' }],
  },
  outbox: { pendingCount: 5, dlqCount: 3, stuckCount: 1, status: 'warning' },
  accounting: { totalVouchers: 1250, unbalancedVouchers: 0, status: 'ok' },
  workflow: { activeInstances: 4, overdueSlaTasks: 2, status: 'warning' },
  server: { nodeVersion: 'v22.22.0', platform: 'linux', uptimeSeconds: 93725, memoryUsageMb: { heapUsed: 120, heapTotal: 256, rss: 300 } },
  checkTimestamp: '2026-10-08T10:00:00.000Z',
};
const report = {
  healthScorePercentage: 80, totalChecks: 5, okChecks: 4, timestamp: '2026-10-08T10:00:00.000Z',
  checks: [{ id: 'dlq', category: 'صف رویدادها', title: 'رویدادهای ناموفق', status: 'warning', details: '۳ رویداد ناموفق در صف مانده است.' }],
};

describe('health page wording (TD-622)', () => {
  it('shows no English word and no Latin digit outside the technical details', async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url === '/system/health') return Promise.resolve(health);
      if (url === '/system/reconciliation-check') return Promise.resolve(report);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const { container } = render(<SystemHealthDiagnostic />);
    await screen.findAllByText(/۸۰|80/);
    const text = visibleText(container);
    expect(latinRuns(text)).toEqual([]);
    expect(latinDigitRuns(text)).toEqual([]);
    expect(text).not.toMatch(/دیتابیس|اسکن|لاگ/);
    expect(text).toContain('۸۰٪');
    expect(text).toContain('۱ روز و ۲ ساعت و ۲ دقیقه و ۵ ثانیه');
    expect(text).toContain('۱۲ میلی‌ثانیه');
    expect(Array.from(container.querySelectorAll('[data-technical]')).map(el => el.textContent).join(' ')).toContain('Node.js');
  });
});

describe('setup wizard wording (TD-622)', () => {
  const fill = (placeholder: string, value: string, index = 0) => {
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[index], { target: { value } });
  };
  /** Step 1 up to the business form; the token field is the first input */
  const toStep2 = async () => {
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'test_setup_token_at_least_16_chars_long' } });
    fill('مثال: علی رضایی', 'مدیر');
    fill('••••••••', 'abcd12345678', 0);
    fill('••••••••', 'abcd12345678', 1);
    fireEvent.click(screen.getByText(/گام بعدی/));
    await screen.findByText(/اطلاعات فروشگاه \/ شرکت جهت درج/);
  };

  it('has no English word or Latin digit in texts, placeholders, options or defaults, and no default company name', async () => {
    const { container } = render(<SetupPage onLogin={vi.fn()} />);
    const step1 = visibleText(container) + ' ' + placeholders(container);
    const tokenHelp = container.querySelector('code')?.textContent;
    await toStep2();
    const step2 = visibleText(container) + ' ' + placeholders(container);
    const options = Array.from(container.querySelectorAll('option')).map(o => o.textContent).join(' ');
    const company = screen.getByPlaceholderText('مثال: فروشگاه مرکزی انبار') as HTMLInputElement;
    expect(latinRuns([step1, step2, options].join(' '))).toEqual([]);
    expect(latinDigitRuns(placeholders(container))).toEqual([]);
    expect(company.value).toBe('');
    expect(tokenHelp).toBe('ERP_SETUP_TOKEN');
  });

  it('refuses a blank company name before sending', async () => {
    render(<SetupPage onLogin={vi.fn()} />);
    await toStep2();
    fill('مثال: فروشگاه مرکزی انبار', '   ');
    fireEvent.submit(screen.getByText(/تکمیل و ورود به سامانه/).closest('form') as HTMLFormElement);
    expect(await screen.findByText(/نام فروشگاه یا شرکت را وارد کنید/)).toBeTruthy();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe('factory reset confirmation (TD-622)', () => {
  const renderModal = (deleteConfirmText: string) => render(
    <ClearDataModal isOpen onClose={vi.fn()} deleteConfirmText={deleteConfirmText} setDeleteConfirmText={vi.fn()} isSaving={false} onConfirmClear={vi.fn()} />,
  );
  const resetButton = () => screen.getByText('پاک‌سازی همه اطلاعات').closest('button') as HTMLButtonElement;

  it('asks for the Persian phrase, not DELETE, and shows no English word', () => {
    const { container } = renderModal('DELETE');
    expect(resetButton().disabled).toBe(true);
    expect(latinRuns(visibleText(container) + ' ' + placeholders(container))).toEqual([]);
    cleanup();
    renderModal('  حذف   همه ');
    expect(resetButton().disabled).toBe(false);
  });
});
