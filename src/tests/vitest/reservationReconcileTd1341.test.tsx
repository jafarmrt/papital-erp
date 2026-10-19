import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { planProjectReservation, type ReservationStockItem } from '../../lib/projects/projectReservation';
import {
  reservationLineChange, reservationLineChangeText, reservationReconcileSummary, type ReservationReconcilePreview,
} from '../../lib/projects/reservationReconcile';

type FetchOpts = { method?: string; body?: string };
let route: (url: string, opts?: FetchOpts) => unknown = () => null;
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => route(url, opts));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) };
});
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { ApiError } from '../../api';
import { ReservationReconcileButton } from '../../components/project/ReservationReconcileDialog';

afterEach(() => { cleanup(); vi.clearAllMocks(); route = () => null; });

// Persian text the screens show (kept in constants: terminal output stays English)
const BUTTON = 'تکمیل رزرو';
const CONFIRM = 'ثبت تغییرهای رزرو';
const NOTHING_TO_DO = 'رزرو با فهرست مواد امروز برابر است و تغییری لازم نیست.';
const SAVE_FIRST = 'ابتدا تغییرهای کنترل موجودی را ذخیره کنید.';
const STALE = 'پروژه را کاربر دیگری تغییر داده؛ دوباره باز کنید.';

const glue: ReservationStockItem = { id: 3, code: 'G-1', name: 'glue', unit: 'عدد', currentStock: 12 };
const sections = (qty: number) => [{ id: 's', title: 'm', checkType: 'global', globalItems: [{ itemCode: 'G-1', name: 'glue', unit: 'عدد', requiredQty: qty }] }];
const plan = (need: number, opts: Parameters<typeof planProjectReservation>[5]) => planProjectReservation(sections(need), [], [glue], [], 'now', opts);

describe('the reconcile keeps the project reservation first (TD-1341)', () => {
  it('without its own reservation the finalize rule is unchanged', () => {
    expect(plan(10, { reservedByOthers: new Map([[3, 4]]) }).reserved[0].reservedQty).toBe(8);
  });

  it('keeps what the project holds and adds only stock nobody holds', () => {
    // stock 12, others 1, own 3: free for the project is 12 - 1 - 3 = 8 on top of its 3
    expect(plan(10, { reservedByOthers: new Map([[3, 1]]), ownReserved: new Map([[3, 3]]) }).reserved[0].reservedQty).toBe(10);
    // a later proforma holding more than is left never shrinks the 8 the project holds
    expect(plan(8, { reservedByOthers: new Map([[3, 9]]), ownReserved: new Map([[3, 8]]) }).reserved[0].reservedQty).toBe(8);
  });

  it('releases what the need no longer asks for and reports the shortfall', () => {
    expect(plan(2, { ownReserved: new Map([[3, 6]]) }).reserved[0].reservedQty).toBe(2);
    const short = plan(20, { reservedByOthers: new Map([[3, 4]]), ownReserved: new Map([[3, 5]]) });
    expect(short.reserved[0].reservedQty).toBe(8);
    expect(short.shortages[0]).toMatchObject({ requiredQty: 20, reservedQty: 8, shortQty: 12 });
  });
});

const line = (currentQty: number, targetQty: number, extra: Partial<ReservationReconcilePreview['lines'][number]> = {}) =>
  ({ itemId: 3, itemCode: 'G-1', itemName: 'glue', unit: 'عدد', requiredQty: targetQty, currentQty, targetQty, shortQty: 0, ...extra });

describe('the reconcile preview text (TD-1341)', () => {
  it('names each change', () => {
    expect(reservationLineChange(line(3, 10))).toBe('reserve');
    expect(reservationLineChange(line(6, 2))).toBe('release');
    expect(reservationLineChange(line(2, 2.00001))).toBe('unchanged');
    expect(reservationLineChangeText(line(3, 10))).toBe('۷ عدد رزرو تازه');
    expect(reservationLineChangeText(line(6, 2))).toBe('۴ عدد آزاد می‌شود');
  });

  it('sums the changes', () => {
    expect(reservationReconcileSummary({ hasChanges: false, lines: [] })).toBe(NOTHING_TO_DO);
    expect(reservationReconcileSummary({ hasChanges: true, lines: [line(3, 10), line(6, 2, { itemId: 4, shortQty: 1 })] }))
      .toBe('۱ کالا رزرو تازه می‌گیرد، رزرو ۱ کالا آزاد می‌شود، ۱ کالا کمبود دارد.');
  });
});

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const preview = (over: Partial<ReservationReconcilePreview> = {}): ReservationReconcilePreview =>
  ({ projectId: 7, version: 4, lines: [line(3, 10)], hasChanges: true, planToken: TOKEN_A, ...over });

describe('the reconcile window (TD-1341)', () => {
  it('waits for a saved list before it opens', () => {
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty onApplied={vi.fn()} />);
    const button = screen.getByRole('button', { name: BUTTON });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toBe(SAVE_FIRST);
  });

  it('shows the plan and posts it with the tab version and its token', async () => {
    const onApplied = vi.fn();
    route = (url, opts) => {
      if (url === '/api/projects/7/reservation-reconcile' && !opts?.method) return preview();
      if (url === '/api/projects/7/reservation-reconcile' && opts?.method === 'POST') return { id: 7, version: 5, changed: true, preview: preview(), inventory_control: { reservedItems: [], reservationShortages: [] } };
      return null;
    };
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty={false} onApplied={onApplied} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(await screen.findByText('۷ عدد رزرو تازه')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ version: 5 })));
    const post = fetchJson.mock.calls.find(c => c[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ version: 4, planToken: TOKEN_A });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the fresh plan when stock changed meanwhile and posts that one next', async () => {
    let posts = 0;
    route = (url, opts) => {
      if (opts?.method !== 'POST') return preview();
      posts += 1;
      if (posts === 1) throw new ApiError('changed', 'PROJECT_RESERVATION_PLAN_CHANGED', 409, { preview: preview({ lines: [line(3, 8)], planToken: TOKEN_B }) });
      return { id: 7, version: 5, changed: true, preview: preview(), inventory_control: { reservedItems: [], reservationShortages: [] } };
    };
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty={false} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    expect(await screen.findByText('۵ عدد رزرو تازه')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(posts).toBe(2));
    const last = fetchJson.mock.calls.filter(c => c[1]?.method === 'POST').at(-1);
    expect(JSON.parse(String(last?.[1]?.body)).planToken).toBe(TOKEN_B);
  });

  it('records nothing when the plan has no change or the tab is behind the project', async () => {
    route = () => preview({ hasChanges: false, lines: [line(5, 5)] });
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty={false} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(await screen.findByText(NOTHING_TO_DO)).toBeTruthy();
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveProperty('disabled', true);
    cleanup();
    route = () => preview({ version: 6 });
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty={false} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(await screen.findByText(STALE)).toBeTruthy();
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveProperty('disabled', true);
  });

  it('is not closed by Esc while the plan is being recorded', async () => {
    let finish: (v: unknown) => void = () => undefined;
    route = (_url, opts) => (opts?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : preview());
    render(<ReservationReconcileButton projectId={7} version={4} busy={false} dirty={false} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON }));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(fetchJson.mock.calls.some(c => c[1]?.method === 'POST')).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { finish({ id: 7, version: 5, changed: true, preview: preview(), inventory_control: { reservedItems: [], reservationShortages: [] } }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
