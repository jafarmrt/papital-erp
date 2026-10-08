import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const projects = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1, projectCode: `PRJ-${i + 1}`, project_code: `PRJ-${i + 1}`, title: `پروژه ${i + 1}`,
  status: i === 59 ? 'paused' : 'in_progress', customerName: '', customer_name: '',
}));
const fetchJson = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/projects/options')) return projects;
  const detail = /^\/projects\/(\d+)$/.exec(url);
  if (detail) return { id: Number(detail[1]), title: `پروژه ${detail[1]}`, stages: [], products: [] };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: () => null }));

import ProjectInventoryPage from '../../pages/ProjectInventoryPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ROOT = join(__dirname, '..', '..');
/** package 11 screens with entity pickers */
const PACKAGE_11 = [
  'pages/ProjectsPage.tsx', 'pages/ProjectInventoryPage.tsx', 'components/ProjectModal.tsx', 'components/ProjectDetailModal.tsx',
  'components/project/', 'components/project-modal/', 'components/inventory/ProjectBomAllocationsTab.tsx',
  'components/settings/WorkflowPresetsTab.tsx',
];
const ENTITY_LISTS = /\b(projects|projectsList|filteredProjects|itemsList|warehouseItems|pieceworkTasksList|availableTasks|personnelList)\.map\(/;
const filesUnder = (path: string): string[] => {
  const full = join(ROOT, path);
  return statSync(full).isDirectory() ? readdirSync(full).flatMap(name => filesUnder(join(path, name))) : [full];
};

// v9.0.423 (TD-767): package 11 picked projects, items and piecework tasks from native selects over the whole list
describe('package 11 entity pickers are searchable (TD-767)', () => {
  it('has no native select over a project, item, personnel or task list', () => {
    const offenders = PACKAGE_11.flatMap(filesUnder).filter(f => /\.tsx$/.test(f)).flatMap(f => {
      const text = readFileSync(f, 'utf8');
      return [...text.matchAll(/<select\b[\s\S]*?<\/select>/g)].filter(m => ENTITY_LISTS.test(m[0])).map(() => relative(ROOT, f));
    });
    expect(offenders).toEqual([]);
  });

  it('finds a project past the first rows by searching the project picker', async () => {
    render(<MemoryRouter initialEntries={['/project-inventory']}><ProjectInventoryPage /></MemoryRouter>);
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url === '/projects/1')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /PRJ-1\]/ }));
    fireEvent.change(screen.getByPlaceholderText('جستجو...'), { target: { value: 'PRJ-60' } });
    const row = screen.getAllByRole('listitem').find(li => li.textContent?.includes('[PRJ-60]'));
    expect(row?.textContent).toContain('متوقف');
    fireEvent.click(row as HTMLElement);
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url === '/projects/60')).toBe(true));
  });
});
