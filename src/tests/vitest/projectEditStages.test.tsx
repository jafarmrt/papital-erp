import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectStagesForm } from '../../components/project-modal/ProjectStagesForm';
import { buildProjectPayload } from '../../components/project-modal/projectFormHelpers';

afterEach(cleanup);

const STAGES = [{ title: 'برش', assigned_personnel: [], required_resources: [] }, { title: 'مونتاژ', assigned_personnel: [], required_resources: [] }];
const noop = () => undefined;

const payload = (includeStages?: boolean) => buildProjectPayload({
  projectCode: 'PRJ-1', title: 'پروژه', selectedCustomerId: null, activeCustomersList: [],
  productsList: [{ id: 'r1', item_id: 7, item_code: 'C7', item_name: 'کالا', customer_code: '', quantity: 2, unit: 'عدد', needs_assembly: false, notes: '' }],
  startDate: '1405/07/16', endDate: '1405/07/20', priority: 'medium', description: '', stages: STAGES,
  ...(includeStages === undefined ? {} : { includeStages }),
});

// v9.0.342 (TD-740, owner decision t2 A): the project edit form shows the stages read-only and never sends them
describe('stages in the project edit form (TD-740)', () => {
  it('shows the stages without inputs and opens the stages section', () => {
    const onOpenStages = vi.fn();
    render(<ProjectStagesForm stages={STAGES} preset="" availablePresets={[]} onSelectPreset={noop} onAddStage={noop}
      onRemoveStage={noop} onStageTitleChange={noop} onMoveStage={noop} readOnly onOpenStages={onOpenStages} />);
    expect(screen.getByText('برش')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText('افزودن مرحله جدید به پایان فرآیند')).toBeNull();
    fireEvent.click(screen.getByText('باز کردن مراحل در جزئیات پروژه'));
    expect(onOpenStages).toHaveBeenCalledTimes(1);
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
