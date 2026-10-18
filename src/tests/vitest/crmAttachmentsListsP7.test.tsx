import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CRMActivity, CRMLead } from '../../types';

const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
}));
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  API_URL: '/api',
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
}));

import { MAX_ATTACHMENT_FILE_MB } from '../../lib/attachments/attachmentBodyLimit';
import {
  CRM_ATTACHMENT_MAX_FILES,
  CRM_ATTACHMENT_MAX_MB,
  crmAttachmentPickError,
  crmAttachmentTypeOf,
  crmAttachmentUrl,
} from '../../lib/crm/crmAttachments';
import { isProtectedAttachmentUrl } from '../../lib/attachments/attachmentDisplay';
import { activityTypeLabel } from '../../lib/crm/activityTypes';
import { activityPageUrl, boardCapNotice, CRM_BOARD_LEAD_CAP, leadPageUrl, toCrmPage } from '../../lib/crm/crmListPages';
import { activityTarget, parseCrmDeepLink, resolveDossierParty } from '../../lib/crm/crmDeepLink';
import { ActivityRowActions } from '../../components/crm/ActivityRowActions';
import { CRMLeadsTable } from '../../components/crm/CRMLeadsTable';
import { useCrmDeepLink } from '../../hooks/useCrmDeepLink';
import { CRMLeadModal } from '../../components/crm/CRMLeadModal';
import { CRMInteractionModal } from '../../components/crm/CRMInteractionModal';
import { useClampPage, useFilterPage } from '../../hooks/useCrmListPages';

const withClient = (node: ReactElement, entry = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
  </QueryClientProvider>
);

afterEach(() => {
  cleanup();
  granted.clear();
  fetchJson.mockReset();
});

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

// v10.2 package 7 (N-02 §3.3, CRM plan decisions ت۶ to ت۸): image and PDF attachments of sales files and activities
describe('crm_attachments_n02_browser', () => {
  it('accepts JPG, PNG, WEBP and PDF only, up to the attachment file size and ten files per record', () => {
    expect(CRM_ATTACHMENT_MAX_MB).toBe(MAX_ATTACHMENT_FILE_MB);
    expect(crmAttachmentTypeOf('a.JPG', '')).toBe('image/jpeg');
    expect(crmAttachmentTypeOf('scan.pdf', 'application/pdf')).toBe('application/pdf');
    expect(crmAttachmentTypeOf('a.gif', 'image/gif')).toBeNull();
    expect(crmAttachmentTypeOf('a.docx', '')).toBeNull();
    expect(crmAttachmentPickError([file('a.png', 'image/png')], 0)).toBeNull();
    expect(crmAttachmentPickError([file('a.svg', 'image/svg+xml')], 0)).toContain('a.svg');
    expect(crmAttachmentPickError([file('big.pdf', 'application/pdf', CRM_ATTACHMENT_MAX_MB * 1024 * 1024 + 1)], 0)).toContain('big.pdf');
    expect(crmAttachmentPickError([file('a.webp', 'image/webp')], CRM_ATTACHMENT_MAX_FILES)).not.toBeNull();
    expect(crmAttachmentPickError([file('a.webp', 'image/webp')], CRM_ATTACHMENT_MAX_FILES - 1)).toBeNull();
  });

  it('downloads the light version of an image through the protected attachment address', () => {
    const id = '0d6f5f8e-3c1d-4f7a-9a52-6c7e8f9a0b1c';
    expect(crmAttachmentUrl(id, 'light')).toBe(`/api/attachments/${id}?variant=light`);
    expect(isProtectedAttachmentUrl(crmAttachmentUrl(id, 'light'))).toBe(true);
    expect(isProtectedAttachmentUrl(crmAttachmentUrl(id))).toBe(true);
  });

  it('shows the attachment button of an activity to a crm.view holder, edit and delete only to crm.manage', () => {
    const activity = { id: 4, title: 'تماس', type: 'call', attachmentCount: 2 } as CRMActivity;
    granted.add('crm.view');
    const { unmount } = render(withClient(<ActivityRowActions activity={activity} onEdit={() => undefined} onDelete={() => undefined} />));
    expect(screen.getByRole('button', { name: /پیوست‌های اقدام/ }).textContent).toContain('۲');
    expect(screen.queryByRole('button', { name: 'ویرایش اقدام' })).toBeNull();
    unmount();
    granted.clear();
    const none = render(withClient(<ActivityRowActions activity={activity} />));
    expect(none.container.textContent).toBe('');
  });
});

// v10.2 package 7 (OBS-R2-28 / OBS-R2-32): lists paged on the server and activity type names
describe('crm_lists_paged_obs_r2_28', () => {
  it('names an e-mail and a task by their own type, never as a note', () => {
    expect(activityTypeLabel('email')).toBe('ایمیل');
    expect(activityTypeLabel('task')).toBe('کار');
    expect(activityTypeLabel('note')).toBe('یادداشت');
    expect(activityTypeLabel('unknown')).not.toBe('یادداشت');
  });

  it('asks one page of sales files and of activities with the page conditions', () => {
    expect(leadPageUrl(new URLSearchParams('stage=lead'), 2, 20)).toBe('/crm/leads?stage=lead&page=2&limit=20');
    expect(activityPageUrl({ fromDate: '2026-10-01', search: ' تماس ', type: 'all', partyId: 7, page: 1, limit: 20 }))
      .toBe(`/crm/activities?page=1&limit=20&fromDate=2026-10-01&search=${encodeURIComponent('تماس')}&partyId=7`);
    expect(toCrmPage([{ id: 1 }], 1, 20)).toMatchObject({ total: 1, totalPages: 1 });
    expect(toCrmPage({ data: [], total: 45, limit: 20 }, 3, 20).totalPages).toBe(3);
    expect(boardCapNotice(CRM_BOARD_LEAD_CAP - 1)).toBeNull();
    expect(boardCapNotice(CRM_BOARD_LEAD_CAP)).not.toBeNull();
  });

  it('pages the sales file table on the server instead of the board list', async () => {
    const lead = (id: number) => ({ id, title: `پرونده ${id}`, stage: 'lead', estimatedValue: 0, currency: 'IRR' }) as CRMLead;
    fetchJson.mockImplementation((url: string) => {
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'));
      return Promise.resolve({ data: [lead(page * 100)], total: 25, page, limit: 10, totalPages: 3 });
    });
    const noop = () => undefined;
    render(withClient(<CRMLeadsTable filterQuery="stage=lead" onOpenLeadDrawer={noop} onOpenActivityModal={noop} onOpenLeadModal={noop} />));
    expect(await screen.findByText('پرونده 100')).toBeTruthy();
    expect(fetchJson.mock.calls.map((c) => String(c[0]))).toContain('/crm/leads?stage=lead&page=1&limit=10');
    fireEvent.click(screen.getByRole('button', { name: 'صفحه بعد' }));
    expect(await screen.findByText('پرونده 200')).toBeTruthy();
  });
});

function DeepLinkHarness({ onLead, onParty, onActivities }: { onLead: (l: CRMLead) => void; onParty: (id: number) => void; onActivities: () => void }) {
  useCrmDeepLink({ openLead: onLead, openParty: onParty, openActivities: onActivities });
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

// v10.2 package 7 (OBS-R2-24): notification links open their record, and a dossier opens only for a real party
describe('crm_navigation_obs_r2_24', () => {
  it('reads the record a link names', () => {
    expect(parseCrmDeepLink('?leadId=12')).toEqual({ leadId: 12, activityId: null });
    expect(parseCrmDeepLink('?activityId=5')).toEqual({ leadId: null, activityId: 5 });
    expect(parseCrmDeepLink('?leadId=')).toBeNull();
    expect(parseCrmDeepLink('?leadId=0')).toBeNull();
    expect(activityTarget({ leadId: 9, customerId: 3 })).toEqual({ kind: 'lead', leadId: 9 });
    expect(activityTarget({ leadId: null, customerId: 3 })).toEqual({ kind: 'party', customerId: 3 });
    expect(activityTarget({})).toEqual({ kind: 'activities' });
  });

  it('finds the dossier party by id, else by one exact name, never a made-up party', () => {
    const parties = [{ id: 3, name: 'گالری فیروزه' }, { id: 4, name: 'Ali' }, { id: 5, name: 'ali ' }];
    expect(resolveDossierParty({ customerId: 3, customerName: 'دیگر' }, parties)?.id).toBe(3);
    expect(resolveDossierParty({ customerId: 99, customerName: 'گالری فیروزه' }, parties)).toBeNull();
    expect(resolveDossierParty({ customerName: ' گالری فیروزه ' }, parties)?.id).toBe(3);
    expect(resolveDossierParty({ customerName: 'ALI' }, parties)).toBeNull();
    expect(resolveDossierParty({ customerName: 'ناشناس' }, parties)).toBeNull();
  });

  it('opens the sales file of a linked activity and clears the address', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url === '/crm/activities/5') return Promise.resolve({ id: 5, leadId: 9, customerId: 3 });
      if (url === '/crm/leads/9') return Promise.resolve({ id: 9, title: 'پرونده نه', stage: 'contacted' });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const onLead = vi.fn();
    const onParty = vi.fn();
    render(withClient(
      <Routes><Route path="/crm" element={<DeepLinkHarness onLead={onLead} onParty={onParty} onActivities={() => undefined} />} /></Routes>,
      '/crm?activityId=5',
    ));
    await waitFor(() => expect(onLead).toHaveBeenCalledTimes(1));
    expect(onLead.mock.calls[0][0]).toMatchObject({ id: 9, stage: 'lead' });
    expect(onParty).not.toHaveBeenCalled();
    expect(screen.getByTestId('address').textContent).toBe('/crm');
  });

  it('opens the party dossier of an activity without a sales file', async () => {
    fetchJson.mockResolvedValue({ id: 6, leadId: null, customerId: 3 });
    const onParty = vi.fn();
    render(withClient(
      <Routes><Route path="/crm" element={<DeepLinkHarness onLead={() => undefined} onParty={onParty} onActivities={() => undefined} />} /></Routes>,
      '/crm?activityId=6',
    ));
    await waitFor(() => expect(onParty).toHaveBeenCalledWith(3));
  });
});

const pressEscape = () => fireEvent.keyDown(window, { key: 'Escape' });

// v10.2 package 7 review (M-2): Esc and the close buttons do not close the sales file or activity window while it saves
describe('crm_windows_keep_open_while_saving', () => {
  const leadForm = { title: '', customerName: '', phone: '', company: '', contacts: [], source: '', stage: 'lead', currency: 'IRR', estimatedValue: '', probability: '', notes: '' };
  const leadModal = (saving: boolean, onClose: () => void) => (
    <CRMLeadModal isLeadModalOpen onCloseLeadModal={onClose} editingLead={null} leadForm={leadForm} setLeadForm={() => undefined}
      isSavingLead={saving} onSaveLead={() => undefined} customersList={[]} personnelList={[]} currentPersonnelId={null} currentLoggedInUser="u" />
  );

  it('keeps the sales file window open on Esc while saving and closes it afterwards', () => {
    const onClose = vi.fn();
    const view = render(withClient(leadModal(true, onClose)));
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'انصراف' })).toHaveProperty('disabled', true);
    view.rerender(withClient(leadModal(false, onClose)));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the activity window open on Esc while saving', () => {
    const onClose = vi.fn();
    const activityModal = (saving: boolean) => (
      <CRMInteractionModal isActivityModalOpen onCloseActivityModal={onClose} selectedLeadForActivity={null} setSelectedLeadForActivity={() => undefined}
        leads={[]} activityForm={{ type: 'call', title: '', description: '', result: '', mentions: [] }} setActivityForm={() => undefined}
        isSavingActivity={saving} onSaveActivity={() => undefined} personnelList={[]} mentionUsers={[]} currentUser={{ id: 1 }} currentLoggedInUser="u"
        isFollowupResultModalOpen={false} onCloseFollowupResultModal={() => undefined} selectedFollowupAct={null}
        followupResultForm={{ result: '', resultNote: '' }} setFollowupResultForm={() => undefined} isSubmittingFollowupResult={false} onConfirmFollowupResult={() => undefined} />
    );
    const view = render(withClient(activityModal(true)));
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(withClient(activityModal(false)));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// v10.2 package 7 review (N-4 / N-5): pages follow their conditions, and an attachment count never drops to zero while loading
describe('crm_pages_and_counts_review_p7', () => {
  it('starts a list on its first page in the same render its conditions change', () => {
    const { result, rerender } = renderHook(({ key }) => useFilterPage(key), { initialProps: { key: 'a' } });
    act(() => result.current[1](4));
    expect(result.current[0]).toBe(4);
    rerender({ key: 'b' });
    expect(result.current[0]).toBe(1);
  });

  it('moves back to the last page when deletions leave the current page empty', () => {
    const setPage = vi.fn();
    const { rerender } = renderHook(({ total, loading }) => useClampPage(5, { totalPages: total, loading, error: null }, setPage), {
      initialProps: { total: 5, loading: false },
    });
    expect(setPage).not.toHaveBeenCalled();
    rerender({ total: 3, loading: true });
    expect(setPage).not.toHaveBeenCalled();
    rerender({ total: 3, loading: false });
    expect(setPage).toHaveBeenCalledWith(3);
  });

  it('opens an activity\'s window on the files its row already has and keeps the badge while the list loads', () => {
    granted.add('crm.view');
    fetchJson.mockReturnValue(new Promise(() => undefined));
    const seed = [1, 2].map((n) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`, name: `f${n}.pdf`, type: 'application/pdf', size: 10, hasLight: false,
      url: `/api/attachments/00000000-0000-4000-8000-00000000000${n}`, lightUrl: null, uploadedBy: 'a', uploadedAt: '2026-10-18T00:00:00Z',
    }));
    const activity = { id: 9, title: 'تماس', type: 'call', attachmentCount: 2, attachments: seed } as unknown as CRMActivity;
    render(withClient(<ActivityRowActions activity={activity} />));
    fireEvent.click(screen.getByRole('button', { name: /پیوست‌های اقدام/ }));
    expect(screen.getByText('f1.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: /پیوست‌های اقدام/ }).textContent).toContain('۲');
  });
});
