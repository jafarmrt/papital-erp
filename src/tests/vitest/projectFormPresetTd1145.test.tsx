import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';

const presets = [
  { id: 'necklace', title: 'ساخت گردنبند', description: '', stages: ['آماده‌سازی مواد', { title: 'مونتاژ', isOptionalPerProduct: true }] },
  { id: 'earring', title: 'ساخت گوشواره', description: '', stages: ['برش', 'بسته‌بندی'] },
];
vi.mock('../../api', () => ({
  fetchJson: vi.fn(async (url: string) => (url === '/settings' ? [{ key: 'project_workflow_presets', value: JSON.stringify(presets) }] : [])),
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { useProjectForm } from '../../components/project-modal/useProjectForm';
import { ProjectStagesForm } from '../../components/project-modal/ProjectStagesForm';
import { NEW_PROJECT_STAGE_TITLE } from '../../components/project-modal/projectFormHelpers';

const props = { isOpen: true, onClose: vi.fn(), projectToEdit: null, customersList: [], itemsList: [], onSuccess: vi.fn() };
const titles = (stages: Array<{ title: string }>) => stages.map(s => s.title);

afterEach(() => cleanup());

describe('v10.0.44 (TD-1145): a new project form applies no stage template until the user picks one', () => {
  it('opens without a template and with one default stage, even when templates exist', async () => {
    const { result } = renderHook(() => useProjectForm(props as never));
    await waitFor(() => expect(result.current.availablePresets).toHaveLength(2));
    expect(result.current.preset).toBe('');
    expect(titles(result.current.stages)).toEqual([NEW_PROJECT_STAGE_TITLE]);
    expect(result.current.getOptionalStageNames()).toEqual([]);
  });

  it('applies a template only when picked, and going back to no template keeps the stages', async () => {
    const { result } = renderHook(() => useProjectForm(props as never));
    await waitFor(() => expect(result.current.availablePresets).toHaveLength(2));
    act(() => result.current.handleSelectPreset('earring'));
    expect(titles(result.current.stages)).toEqual(['برش', 'بسته‌بندی']);
    act(() => result.current.handleSelectPreset('necklace'));
    expect(result.current.getOptionalStageNames()).toEqual(['مونتاژ']);
    act(() => result.current.handleSelectPreset(''));
    expect(result.current.preset).toBe('');
    expect(titles(result.current.stages)).toEqual(['آماده‌سازی مواد', 'مونتاژ']);
    expect(result.current.getOptionalStageNames()).toEqual([]);
  });

  it('offers a «بدون الگو» choice in the template picker', () => {
    render(
      <ProjectStagesForm stages={[{ title: NEW_PROJECT_STAGE_TITLE, assigned_personnel: [], required_resources: [] }]} preset=""
        availablePresets={presets} onSelectPreset={vi.fn()} onAddStage={vi.fn()} onRemoveStage={vi.fn()}
        onStageTitleChange={vi.fn()} onMoveStage={vi.fn()} />,
    );
    const empty = screen.getByRole('option', { name: 'بدون الگو' }) as HTMLOptionElement;
    expect(empty.value).toBe('');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });
});
