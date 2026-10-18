import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';

/*
 * 10.2 package 10, delta N3: «بازگشت به نمای گوشی» asks only for a tab the two layouts build differently (progress, and
 * the overview without its specs form). The materials and workshop tabs are the same component in both layouts, so an
 * unsaved change there stays on screen and is not asked about.
 */
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه گوشی', status: 'in_progress', quantity: 5, unit: 'عدد',
  customer_name: 'گالری نمونه', progress_percent: 40, start_date: '1999-12-01', end_date: '2000-01-01',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد' }],
  stages: [], inventory_control: {},
};
const steps = { requisitions: { open: 0, ordered: 0, received: 0 }, allocations: { open: 0, consumed: 0, issueDocuments: 0 }, delivery: { products: 1, completeProducts: 0, delivered: 0, planned: 5, unit: 'عدد' } };
vi.mock('../../api', () => ({
  fetchJson: async (url: string) => (url === '/projects/7/steps' ? steps : url === '/projects/7' ? project : []),
  isAbortError: () => false,
}));
const confirmAction = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => confirmAction() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
/** a tab holding an unsaved change from the moment it opens */
function DirtyTab({ onDirtyChange, label }: { onDirtyChange?: (dirty: boolean) => void; label: string }) {
  useEffect(() => { onDirtyChange?.(true); }, [onDirtyChange]);
  return <p>{label}</p>;
}
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: (p: { onDirtyChange?: (d: boolean) => void }) => <DirtyTab onDirtyChange={p.onDirtyChange} label="materials-tab" /> }));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: (p: { onDirtyChange?: (d: boolean) => void }) => <DirtyTab onDirtyChange={p.onDirtyChange} label="workshop-tab" /> }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectStockEntryTab', () => ({ default: () => null }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import { renderProjectPage } from './helpers/projectPage';
import { PROJECT_WORKSPACE_TAB_LABELS } from '../../lib/projects/projectWorkspaceTabs';

function setPhoneScreen() {
  window.matchMedia = ((query: string) => ({
    matches: query === PHONE_WIDTH_QUERY, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('phone and full view switch keeps tabs built the same in both layouts (delta N3)', () => {
  for (const [tab, label] of [['materials', 'materials-tab'], ['workshop', 'workshop-tab']] as const) {
    it(`does not ask about unsaved changes of the ${tab} tab`, async () => {
      setPhoneScreen();
      renderProjectPage('/projects/7');
      fireEvent.click(await screen.findByText('نمای کامل مشخصات و مراحل'));
      fireEvent.click(await screen.findByRole('tab', { name: new RegExp(PROJECT_WORKSPACE_TAB_LABELS[tab]) }));
      expect(await screen.findByText(label)).toBeTruthy();
      fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
      await waitFor(() => expect(screen.queryByText('بازگشت به نمای گوشی')).toBeNull());
      expect(screen.getByText(label)).toBeTruthy();
      expect(confirmAction).not.toHaveBeenCalled();
    });
  }
});
