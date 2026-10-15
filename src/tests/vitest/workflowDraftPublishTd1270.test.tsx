import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t, toast: t };
});
const confirmAction = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...(args as [])) }));
const holdsSwitch = { value: true };
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => holdsSwitch.value }));
const fetchJson = vi.fn();
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api')>()), fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { workflowVersionDiff, hasUnpublishedDraft } from '../../lib/workflow/workflowVersionDiff';
import { WorkflowDefinitionCard } from '../../components/workflow/WorkflowDefinitionCard';
import { WorkflowDraftPanel } from '../../components/workflow/WorkflowDraftPanel';
import { WorkflowVersionHistoryModal } from '../../components/workflow/WorkflowVersionHistoryModal';

// TD-1270 (D-06 part D): a design save reached new records at once, with no draft, no review of what changed and no way
// back to an earlier version except designing it again by hand.

afterEach(() => cleanup());
beforeEach(() => {
  confirmAction.mockClear();
  fetchJson.mockReset();
  holdsSwitch.value = true;
});

const withQuery = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>
);

const published = {
  states: [
    { id: 1, stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
    { id: 2, stateKey: 'ok', title: 'تأیید شده', stateType: 'terminal' },
    { id: 3, stateKey: 'old', title: 'بررسی قدیمی', stateType: 'intermediate' },
  ],
  transitions: [
    { id: 10, fromStateId: 1, toStateId: 2, actionKey: 'approve', title: 'تأیید', requiredPermission: 'documents.edit' },
    { id: 11, fromStateId: 1, toStateId: 3, actionKey: 'review', title: 'بررسی' },
  ],
};
// the same design saved again: new ids, one step renamed, one removed, one added, one action's permission changed
const draft = {
  states: [
    { id: 21, stateKey: 'draft', title: 'پیش‌نویس فروش', stateType: 'initial' },
    { id: 22, stateKey: 'ok', title: 'تأیید شده', stateType: 'terminal' },
    { id: 23, stateKey: 'boss', title: 'تأیید مدیر', stateType: 'intermediate' },
  ],
  transitions: [
    { id: 30, fromStateId: 21, toStateId: 22, actionKey: 'approve', title: 'تأیید', requiredPermission: 'workflow.approve' },
    { id: 31, fromStateId: 21, toStateId: 23, actionKey: 'boss', title: 'ارسال به مدیر' },
  ],
};

describe('workflow version diff (TD-1270)', () => {
  it('matches steps by key and actions by their steps and key, never by database id', () => {
    const diff = workflowVersionDiff(published, draft);
    expect(diff.addedSteps.map(s => s.title)).toEqual(['تأیید مدیر']);
    expect(diff.removedSteps.map(s => s.title)).toEqual(['بررسی قدیمی']);
    expect(diff.changedSteps).toEqual([{ key: 'draft', title: 'پیش‌نویس فروش', changes: [{ field: 'title', label: 'عنوان', before: 'پیش‌نویس', after: 'پیش‌نویس فروش' }] }]);
    expect(diff.addedActions.map(a => a.title)).toEqual(['ارسال به مدیر']);
    expect(diff.removedActions.map(a => a.title)).toEqual(['بررسی']);
    expect(diff.changedActions[0].changes).toEqual([{ field: 'requiredPermission', label: 'مجوز', before: 'documents.edit', after: 'workflow.approve' }]);
    expect(diff.unchanged).toBe(false);
  });

  it('a design saved again unchanged, with new ids and moved steps, is unchanged', () => {
    const shifted = {
      states: published.states.map(s => ({ ...s, id: s.id + 100, positionX: 999 })),
      transitions: published.transitions.map(t => ({ ...t, id: t.id + 100, fromStateId: t.fromStateId + 100, toStateId: t.toStateId + 100 })),
    };
    expect(workflowVersionDiff(published, shifted).unchanged).toBe(true);
  });

  it('a definition has an unpublished draft only when its latest version is above the published one', () => {
    expect(hasUnpublishedDraft({ version: 3, publishedVersion: 2 })).toBe(true);
    expect(hasUnpublishedDraft({ version: 3, publishedVersion: 3 })).toBe(false);
    expect(hasUnpublishedDraft({ version: 3, publishedVersion: null })).toBe(false);
  });
});

const noActions = { activate: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), pending: false };

describe('workflow definition card (TD-1270)', () => {
  it('shows the published version and a draft waiting to be published', () => {
    const base = { id: 7, code: 'WF_X', title: 'گردش کار آزمون', entityType: 'document', isActive: 1, isArchived: 0 };
    const { rerender } = render(<WorkflowDefinitionCard def={{ ...base, version: 4, publishedVersion: 3 }} canSwitch actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('نسخه منتشرشده ۳')).toBeTruthy();
    expect(screen.getByText('پیش‌نویس منتشرنشده (نسخه ۴)')).toBeTruthy();
    rerender(<WorkflowDefinitionCard def={{ ...base, version: 4, publishedVersion: 4 }} canSwitch actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByText(/پیش‌نویس منتشرنشده/)).toBeNull();
  });
});

describe('draft panel (TD-1270)', () => {
  const draftState = { definitionId: 7, publishedVersion: 3, draftVersion: 4, diff: workflowVersionDiff(published, draft) };

  it('lists what the draft changes and publishes the draft the admin looked at', async () => {
    fetchJson.mockImplementation(async (url: string) => (url.endsWith('/draft') ? draftState : { success: true, data: { publishedVersion: 4 } }));
    render(withQuery(<WorkflowDraftPanel definitionId={7} canPublish />));
    expect(await screen.findByText('گام‌های افزوده (۱)')).toBeTruthy();
    expect(screen.getByText('تأیید مدیر')).toBeTruthy();
    expect(screen.getByText('مجوز: «documents.edit» به «workflow.approve»')).toBeTruthy();
    fireEvent.click(screen.getByText('انتشار نسخه ۴'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workflow/definitions/7/publish', { method: 'POST', body: JSON.stringify({ draftVersion: 4 }) }));
    expect(confirmAction).toHaveBeenCalledTimes(1);
  });

  it('without workflow.admin it shows the draft but no publish button', async () => {
    fetchJson.mockResolvedValue(draftState);
    render(withQuery(<WorkflowDraftPanel definitionId={7} canPublish={false} />));
    expect(await screen.findByText(/انتشار پیش‌نویس با دارنده مجوز/)).toBeTruthy();
    expect(screen.queryByText('انتشار نسخه ۴')).toBeNull();
  });

  it('says when there is nothing to publish', async () => {
    fetchJson.mockResolvedValue({ definitionId: 7, publishedVersion: 3, draftVersion: null, diff: null });
    render(withQuery(<WorkflowDraftPanel definitionId={7} canPublish />));
    expect(await screen.findByText(/پیش‌نویس منتشرنشده‌ای نیست/)).toBeTruthy();
  });
});

describe('version history revert (TD-1270)', () => {
  const versions = [
    { id: 13, definitionId: 7, version: 3, status: 'published', title: 't', description: 'برگرداندن', createdAt: '2026-10-03T10:00:00Z', dslJson: published },
    { id: 12, definitionId: 7, version: 2, status: 'retired', title: 't', description: 'ذخیره', createdAt: '2026-10-02T10:00:00Z', dslJson: draft },
  ];
  const answer = (url: string) => {
    if (url.endsWith('/versions')) return versions;
    if (url.endsWith('/draft')) return { definitionId: 7, publishedVersion: 3, draftVersion: null, diff: null };
    return { success: true, data: { publishedVersion: 4, revertedFrom: 2 } };
  };

  it('labels each version and reverts to an earlier one as a new published version', async () => {
    fetchJson.mockImplementation(async (url: string) => answer(url));
    render(withQuery(<WorkflowVersionHistoryModal definitionId={7} title="آزمون" onClose={vi.fn()} />));
    expect(await screen.findByText('منتشرشده')).toBeTruthy();
    expect(screen.getByText('کنارگذاشته')).toBeTruthy();
    // the published version itself, with no draft waiting, is not reverted to
    expect(screen.queryByText('برگرداندن به نسخه ۳')).toBeNull();
    fireEvent.click(screen.getByText('نسخه ۲'));
    fireEvent.click(screen.getByText('برگرداندن به نسخه ۲'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workflow/definitions/7/revert', { method: 'POST', body: JSON.stringify({ version: 2 }) }));
  });

  it('offers no revert without workflow.admin', async () => {
    holdsSwitch.value = false;
    fetchJson.mockImplementation(async (url: string) => answer(url));
    render(withQuery(<WorkflowVersionHistoryModal definitionId={7} title="آزمون" onClose={vi.fn()} />));
    fireEvent.click(await screen.findByText('نسخه ۲'));
    expect(screen.queryByText(/برگرداندن به نسخه/)).toBeNull();
  });
});
