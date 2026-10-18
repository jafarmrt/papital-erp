import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه کارگاه', status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-09-22', products: [], stages: [], inventory_control: { isFinalized: false, sections: [] },
};
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => (url === '/projects/7' ? project : []));
const confirmAction = vi.fn(async () => true);
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => confirmAction() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));
// the form saves like useProjectForm: onSaved first, then the editor closes
vi.mock('../../components/project/workspace/ProjectSpecsEditor', () => ({
  ProjectSpecsEditor: ({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) => (
    <div data-testid="specs-editor">
      <button type="button" onClick={() => { onSaved(); onCancel(); }}>save specs</button>
      <button type="button" onClick={onCancel}>cancel specs</button>
    </div>
  ),
}));

import ProjectDetailPage from '../../pages/ProjectDetailPage';
import { QueryWrapper } from './helpers/queryWrapper';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

const renderInBrowser = () => render(
  <QueryWrapper>
    <BrowserRouter>
      <Routes>
        <Route path="/projects" element={<Link to="/projects/7?edit=1">edit project</Link>} />
        <Route path="/projects/:projectId/:tab?" element={<ProjectDetailPage />} />
      </Routes>
      <LocationProbe />
    </BrowserRouter>
  </QueryWrapper>,
);

const location = () => screen.getByTestId('location').textContent;
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

beforeEach(() => { window.history.replaceState(null, '', '/projects'); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// v10.2.1 (10.2 package 2, delta review M-A): the real browser history around the specs editor
describe('project specs editor and the browser history (10.2 package 2)', () => {
  it.each([['save specs'], ['cancel specs']])('after %s one back lands on the list with no question', async (button) => {
    renderInBrowser();
    fireEvent.click(screen.getByText('edit project'));
    expect(await screen.findByTestId('specs-editor')).toBeTruthy();
    await waitFor(() => expect(location()).toBe('/projects/7'));
    await settle();

    fireEvent.click(screen.getByText(button));
    await waitFor(() => expect(screen.queryByTestId('specs-editor')).toBeNull());
    await settle();

    window.history.back();
    await waitFor(() => expect(location()).toBe('/projects'));
    await settle();
    expect(screen.queryByTestId('specs-editor')).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
