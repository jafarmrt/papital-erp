import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { hasMatrixProducts } from '../../lib/projects/progressMatrix';
import { matrixProjectStatus } from '../../lib/projects/projectStatus';
import { StageStatusField } from '../../components/project/StageStatusField';

// v9.0.365 (TD-738) and v9.0.366 (TD-758): who sets a project's and a stage's status
describe('project status from the progress matrix (TD-738)', () => {
  it('never changes a paused or cancelled project', () => {
    expect(matrixProjectStatus('cancelled', { allDone: true, anyProgress: true })).toBe('cancelled');
    expect(matrixProjectStatus('paused', { allDone: true, anyProgress: true })).toBe('paused');
  });

  it('completes, starts and reopens other projects by the matrix', () => {
    expect(matrixProjectStatus('in_progress', { allDone: true, anyProgress: true })).toBe('completed');
    expect(matrixProjectStatus('planned', { allDone: false, anyProgress: true })).toBe('in_progress');
    expect(matrixProjectStatus('completed', { allDone: false, anyProgress: false })).toBe('in_progress');
    expect(matrixProjectStatus('planned', { allDone: false, anyProgress: false })).toBe('planned');
  });
});

describe('manual stage status only without products (TD-758)', () => {
  it('knows which projects have a progress matrix', () => {
    expect(hasMatrixProducts({ products: [{ item_id: 7 }] })).toBe(true);
    expect(hasMatrixProducts({ products: [], itemId: 3 })).toBe(true);
    expect(hasMatrixProducts({ products: [] })).toBe(false);
    expect(hasMatrixProducts({ products: [{ item_name: 'بی کد' }] })).toBe(false);
  });

  it('lets the user pick a stage status and percent', () => {
    const onStatus = vi.fn();
    const onProgress = vi.fn();
    render(<StageStatusField status="pending" progress={0} onStatusChange={onStatus} onProgressChange={onProgress} />);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['در انتظار شروع', 'در حال انجام', 'تکمیل‌شده', 'متوقف / مانع']);
    fireEvent.change(screen.getByLabelText('وضعیت مرحله'), { target: { value: 'completed' } });
    expect(onStatus).toHaveBeenCalledWith('completed');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '55' } });
    expect(onProgress).toHaveBeenCalledWith(55);
  });
});
