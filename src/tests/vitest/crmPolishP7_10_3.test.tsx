import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: () => true,
  useAuth: () => ({ userPermissions: { permissions: [], isAdmin: true } }),
}));
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  API_URL: '/api',
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  getAuthToken: () => null,
  isAbortError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
}));

import { useFilterPage } from '../../hooks/useCrmListPages';
import { attachmentDownloadName } from '../../lib/attachments/attachmentDownloadName';
import { useLeadDrawerActivities } from '../../hooks/useLeadDrawerActivities';
import { CRMLeadModal } from '../../components/crm/CRMLeadModal';
import { CRMInteractionModal } from '../../components/crm/CRMInteractionModal';
import { LostReasonDialog } from '../../components/crm/LostReasonFields';
import { Modal } from '../../components/common/Modal';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const withClient = (node: ReactElement) => (
  <QueryClientProvider client={client()}>
    <MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>
);

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// 10.3 package 7: CRM polish (review of PR #323 and the package 2 leftover)
describe('crm_polish_10_3_p7', () => {
  it('starts on page 1 when the list goes back to conditions it showed before', () => {
    const { result, rerender } = renderHook(({ key }) => useFilterPage(key), { initialProps: { key: 'a' } });
    act(() => result.current[1](3));
    expect(result.current[0]).toBe(3);
    rerender({ key: 'b' });
    expect(result.current[0]).toBe(1);
    rerender({ key: 'a' });
    expect(result.current[0]).toBe(1);
  });

  it('replaces only a known extension in a download name', () => {
    expect(attachmentDownloadName('Report v1.2 final', 'application/pdf')).toBe('Report v1.2 final.pdf');
    expect(attachmentDownloadName('نسخه ۲.۵', 'image/jpeg')).toBe('نسخه ۲.۵.jpg');
    expect(attachmentDownloadName('report.v2.pdf', 'application/pdf')).toBe('report.v2.pdf');
    expect(attachmentDownloadName('فاکتور.pdf', 'image/jpeg')).toBe('فاکتور.jpg');
    expect(attachmentDownloadName('scan.JPEG', 'image/jpeg')).toBe('scan.JPEG');
    expect(attachmentDownloadName('photo.heic', 'image/webp')).toBe('photo.webp');
    expect(attachmentDownloadName('.pdf', 'application/pdf')).toBe('.pdf');
    expect(attachmentDownloadName('  ', 'application/pdf')).toBe('attachment.pdf');
    expect(attachmentDownloadName('data.bin', 'application/x-unknown')).toBe('data.bin');
  });

  it('shows the close and cancel buttons of the CRM windows as disabled while they save', () => {
    const leadForm = { title: '', customerName: '', phone: '', company: '', contacts: [], source: '', stage: 'lead', currency: 'IRR', estimatedValue: '', probability: '', notes: '' };
    const disabledLook = (button: HTMLElement) => {
      expect(button).toHaveProperty('disabled', true);
      expect(button.className).toMatch(/disabled:opacity-/);
      expect(button.className).toMatch(/disabled:cursor-not-allowed/);
    };
    const lead = render(withClient(
      <CRMLeadModal isLeadModalOpen onCloseLeadModal={() => undefined} editingLead={null} leadForm={leadForm} setLeadForm={() => undefined}
        isSavingLead onSaveLead={() => undefined} customersList={[]} personnelList={[]} currentPersonnelId={null} currentLoggedInUser="u" />,
    ));
    disabledLook(screen.getByRole('button', { name: 'انصراف' }));
    disabledLook(screen.getByRole('button', { name: '✕' }));
    lead.unmount();

    const interaction = (savingActivity: boolean, savingResult: boolean) => (
      <CRMInteractionModal isActivityModalOpen={savingActivity} onCloseActivityModal={() => undefined} selectedLeadForActivity={null} setSelectedLeadForActivity={() => undefined}
        leads={[]} activityForm={{ type: 'call', title: '', description: '', result: '', mentions: [] }} setActivityForm={() => undefined}
        isSavingActivity={savingActivity} onSaveActivity={() => undefined} personnelList={[]} mentionUsers={[]} currentUser={{ id: 1 }} currentLoggedInUser="u"
        isFollowupResultModalOpen={savingResult} onCloseFollowupResultModal={() => undefined} selectedFollowupAct={savingResult ? { id: 1, title: 'پیگیری' } as never : null}
        followupResultForm={{ result: '', resultNote: '' }} setFollowupResultForm={() => undefined} isSubmittingFollowupResult={savingResult} onConfirmFollowupResult={() => undefined} />
    );
    const activity = render(withClient(interaction(true, false)));
    disabledLook(screen.getByRole('button', { name: 'انصراف' }));
    disabledLook(screen.getByRole('button', { name: '✕' }));
    activity.unmount();
    render(withClient(interaction(false, true)));
    disabledLook(screen.getByRole('button', { name: 'انصراف' }));
    disabledLook(screen.getByRole('button', { name: '✕' }));
  });

  it('disables «انصراف» of the lost reason window while it records', async () => {
    let finish: () => void = () => undefined;
    const onCancel = vi.fn();
    render(<LostReasonDialog leadTitle="سفارش" onCancel={onCancel} onConfirm={() => new Promise<void>((resolve) => { finish = resolve; })} />);
    fireEvent.click(screen.getByText('سایر'));
    fireEvent.change(screen.getByLabelText('شرح دلیل از دست رفتن'), { target: { value: 'تعطیلی کارگاه مشتری' } });
    fireEvent.click(screen.getByText('ثبت «از دست رفته»'));
    const cancel = await screen.findByRole('button', { name: 'انصراف' });
    await waitFor(() => expect(cancel).toHaveProperty('disabled', true));
    expect(cancel.className).toMatch(/disabled:opacity-/);
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(cancel).toHaveProperty('disabled', false);
  });

  it('disables the shared window close button on request', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} title="پیوست‌ها" closeDisabled><p>بدنه</p></Modal>);
    const close = screen.getByRole('button', { name: 'بستن پنجره' });
    expect(close).toHaveProperty('disabled', true);
    expect(close.className).toMatch(/disabled:opacity-/);
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reads a sales file again when the drawer is asked to show the file it already shows', async () => {
    let title = 'نخست';
    fetchJson.mockImplementation(async () => ({ id: 7, title, stage: 'lead', activities: [] }));
    const queryClient = client();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ id, opening }) => useLeadDrawerActivities(id, opening), {
      wrapper, initialProps: { id: 7 as number | null, opening: 1 },
    });
    await waitFor(() => expect(result.current.drawerLead?.title).toBe('نخست'));
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // a render that is not a new showing reads nothing
    rerender({ id: 7, opening: 1 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    title = 'تازه';
    rerender({ id: 7, opening: 2 });
    // the drawer keeps what it shows while the file is read again
    expect(result.current.drawerLead?.title).toBe('نخست');
    await waitFor(() => expect(result.current.drawerLead?.title).toBe('تازه'));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[1][0]).toBe('/crm/leads/7');
  });
});
