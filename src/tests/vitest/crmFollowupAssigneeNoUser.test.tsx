import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: () => true,
  useAuth: () => ({ userPermissions: { permissions: [], isAdmin: true } }),
}));
vi.mock('../../api', () => ({
  API_URL: '/api',
  fetchJson: vi.fn(),
  getAuthToken: () => null,
  isAbortError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
}));

import { CRMInteractionModal } from '../../components/crm/CRMInteractionModal';
import { FOLLOWUP_ASSIGNEE_NO_USER_TAG, FOLLOWUP_ASSIGNEE_NO_USER_TEXT, personnelHasNoUser } from '../../lib/crm/crmScreenText';

const LINKED = { id: 1, fullName: 'Linked Seller', jobTitle: null, employmentStatus: 'active', userId: 7 };
const UNLINKED = { id: 2, fullName: 'Unlinked Seller', jobTitle: null, employmentStatus: 'active', userId: null };

const withClient = (node: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>
);

const modal = (assignedPersonnelId: number | null, assignedTo: string, nextFollowUpDate = '1405/08/11') => withClient(
  <CRMInteractionModal isActivityModalOpen onCloseActivityModal={() => undefined} selectedLeadForActivity={null} setSelectedLeadForActivity={() => undefined}
    leads={[]} activityForm={{ type: 'call', title: '', description: '', result: '', mentions: [], nextFollowUpDate, nextFollowUpTask: '', assignedPersonnelId, assignedTo }}
    setActivityForm={() => undefined} isSavingActivity={false} onSaveActivity={() => undefined} personnelList={[LINKED, UNLINKED]} mentionUsers={[]}
    currentUser={{ id: 1 }} currentLoggedInUser="u" isFollowupResultModalOpen={false} onCloseFollowupResultModal={() => undefined} selectedFollowupAct={null}
    followupResultForm={{ result: '', resultNote: '' }} setFollowupResultForm={() => undefined} isSubmittingFollowupResult={false} onConfirmFollowupResult={() => undefined} />,
);

afterEach(() => cleanup());

// v11 owner report (11 Aban 1405): a follow-up whose responsible personnel has no linked user reaches no inbox
describe('crm_followup_assignee_without_user', () => {
  it('judges only a pick row that carries the user link field', () => {
    expect(personnelHasNoUser(UNLINKED)).toBe(true);
    expect(personnelHasNoUser({ userId: '' })).toBe(true);
    expect(personnelHasNoUser(LINKED)).toBe(false);
    expect(personnelHasNoUser({ userId: '7' })).toBe(false);
    expect(personnelHasNoUser({})).toBe(false);
    expect(personnelHasNoUser(null)).toBe(false);
  });

  it('warns when the chosen responsible has no linked user', () => {
    render(modal(UNLINKED.id, UNLINKED.fullName));
    expect(screen.getByRole('status').textContent).toBe(FOLLOWUP_ASSIGNEE_NO_USER_TEXT);
  });

  it('says nothing for a plain logged call without a next follow-up date', () => {
    render(modal(UNLINKED.id, UNLINKED.fullName, ''));
    expect(screen.queryByText(FOLLOWUP_ASSIGNEE_NO_USER_TEXT)).toBeNull();
  });

  it('does not guess for a responsible outside the pick list', () => {
    render(modal(3, 'Unknown', '1405/08/11'));
    expect(screen.queryByText(FOLLOWUP_ASSIGNEE_NO_USER_TEXT)).toBeNull();
  });

  it('says nothing for a linked responsible or no responsible', () => {
    const linked = render(modal(LINKED.id, LINKED.fullName));
    expect(screen.queryByText(FOLLOWUP_ASSIGNEE_NO_USER_TEXT)).toBeNull();
    linked.unmount();
    render(modal(null, ''));
    expect(screen.queryByText(FOLLOWUP_ASSIGNEE_NO_USER_TEXT)).toBeNull();
  });

  it('tags the unlinked personnel in the picker list', async () => {
    render(modal(null, ''));
    fireEvent.click(screen.getByLabelText('مسئول پیگیری (پرسنل)'));
    expect(await screen.findByText(`${UNLINKED.fullName} (${FOLLOWUP_ASSIGNEE_NO_USER_TAG})`)).toBeTruthy();
    expect(screen.queryByText(`${LINKED.fullName} (${FOLLOWUP_ASSIGNEE_NO_USER_TAG})`)).toBeNull();
  });
});
