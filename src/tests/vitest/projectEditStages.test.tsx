import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => []) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { fetchJson } from '../../api';
import { ProjectStagesForm } from '../../components/project-modal/ProjectStagesForm';
import { buildProjectPayload } from '../../components/project-modal/projectFormHelpers';
import { ProjectSpecsEditor } from '../../components/project/workspace/ProjectSpecsEditor';
import type { ProductionProject } from '../../types';
import { QueryWrapper } from './helpers/queryWrapper';

afterEach(cleanup);

const STAGES = [{ title: 'برش', assigned_personnel: [], required_resources: [] }, { title: 'مونتاژ', assigned_personnel: [], required_resources: [] }];
const noop = () => undefined;

const payload = (includeStages?: boolean) => buildProjectPayload({
  projectCode: 'PRJ-1', title: 'پروژه', selectedCustomerId: null, activeCustomersList: [],
  productsList: [{ id: 'r1', item_id: 7, item_code: 'C7', item_name: 'کالا', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false, notes: '' }],
  startDate: '1405/07/16', endDate: '1405/07/20', priority: 'medium', description: '', stages: STAGES,
  ...(includeStages === undefined ? {} : { includeStages }),
});

// v9.0.384 (TD-740, owner decision t2 A): editing a project never sends its stages
describe('stages in the project edit form (TD-740)', () => {
  // v10.2.x (10.2 package 2): the specs are edited on the project page; the stages stay with their own cards there
  it('edits the specs of a project without its stages', async () => {
    const project = { id: 7, version: 2, project_code: 'PRJ-7', title: 'پروژه', status: 'planned', products: [], stages: [{ id: 1, title: 'برش' }] } as unknown as ProductionProject;
    render(<QueryWrapper><ProjectSpecsEditor project={project} onSaved={noop} onCancel={noop} /></QueryWrapper>);
    await waitFor(() => expect(vi.mocked(fetchJson)).toHaveBeenCalled());
    expect(screen.getByRole('form', { name: 'ویرایش مشخصات پروژه' })).toBeTruthy();
    expect(screen.queryByText('برش')).toBeNull();
    expect(screen.queryByText('افزودن مرحله جدید به پایان فرآیند')).toBeNull();
  });

  it('keeps the editable stages for a new project', () => {
    render(<ProjectStagesForm stages={STAGES} preset="" availablePresets={[]} onSelectPreset={noop} onAddStage={noop}
      onRemoveStage={noop} onStageTitleChange={noop} onMoveStage={noop} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('sends the stages only when a project is created', () => {
    expect(payload().initial_stages?.map(s => s.title)).toEqual(['برش', 'مونتاژ']);
    expect('initial_stages' in payload(false)).toBe(false);
  });
});
