import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CRMLead } from '../../types';

vi.mock('../../api', () => ({ fetchJson: vi.fn() }));

import { CRMKanbanPipeline } from '../../components/crm/CRMKanbanPipeline';
import {
  PIPELINE_COLUMN_WIDTH_PX, PIPELINE_DRAG_TYPE, draggedLeadId, isFollowupOverdue, leadsOfStage, stageAfterDrop,
} from '../../lib/crm/pipelineBoard';

const lead = (id: number, stage: string, extra: Partial<CRMLead> = {}): CRMLead => ({
  id, title: `پرونده ${id}`, stage, estimatedValue: 1_000_000, currency: 'IRR', probability: 50, assignedTo: 'زهرا', status: 'active', ...extra,
});

const LEADS = [lead(1, 'lead'), lead(2, 'qualified', { nextFollowUpDate: '2000-01-01' }), lead(3, 'qualified')];

const handlers = () => ({
  onOpenLeadDrawer: vi.fn(), onOpenActivityModal: vi.fn(), onOpenLeadModal: vi.fn(), onStageChange: vi.fn(),
});

function setPhone(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: phone, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
}

function dropOn(stage: string, leadId: string) {
  const column = document.querySelector(`[data-pipeline-stage="${stage}"]`) as HTMLElement;
  const dataTransfer = { types: [PIPELINE_DRAG_TYPE], getData: (type: string) => (type === PIPELINE_DRAG_TYPE ? leadId : ''), dropEffect: '' };
  fireEvent.dragOver(column, { dataTransfer });
  fireEvent.drop(column, { dataTransfer });
}

afterEach(() => {
  cleanup();
  setPhone(false);
});

// v10.1.24 (N-02 part 3, TD-1272): the pipeline board's columns never overlap, cards are dragged between stages, a phone
// shows one stage per tab. Before, the columns sat in a five-column grid narrower than their 260 px minimum.
describe('CRM pipeline board (TD-1272)', () => {
  it('decides a drop only for a known card moving to another stage', () => {
    expect(stageAfterDrop(LEADS, 1, 'qualified')).toBe('qualified');
    expect(stageAfterDrop(LEADS, 2, 'qualified')).toBeNull();
    expect(stageAfterDrop(LEADS, 99, 'won')).toBeNull();
    expect(draggedLeadId('12')).toBe(12);
    expect(draggedLeadId('عنوان کشیده‌شده')).toBeNull();
    expect(draggedLeadId('0')).toBeNull();
    expect(leadsOfStage(LEADS, 'qualified').map((l) => l.id)).toEqual([2, 3]);
  });

  it('marks a follow-up overdue only before the business today', () => {
    expect(isFollowupOverdue('2026-10-14', '2026-10-15')).toBe(true);
    expect(isFollowupOverdue('2026-10-15', '2026-10-15')).toBe(false);
    expect(isFollowupOverdue('', '2026-10-15')).toBe(false);
    expect(isFollowupOverdue(null, '2026-10-15')).toBe(false);
  });

  it('lays the columns out at a fixed width in a scrolling row, not in a grid', () => {
    setPhone(false);
    const { container } = render(<CRMKanbanPipeline leads={LEADS} {...handlers()} />);
    const board = container.firstElementChild as HTMLElement;
    expect(board.className).toContain('flex');
    expect(board.className).toContain('overflow-x-auto');
    expect(board.className).not.toMatch(/grid-cols/);
    const columns = container.querySelectorAll('[data-pipeline-stage]');
    expect(columns).toHaveLength(5);
    columns.forEach((c) => {
      expect((c as HTMLElement).style.width).toBe(`${PIPELINE_COLUMN_WIDTH_PX}px`);
      expect(c.className).toContain('shrink-0');
    });
    expect(container.querySelector('[data-pipeline-lead="1"]')?.getAttribute('draggable')).toBe('true');
  });

  it('changes the stage through the same handler as the stage picker when a card is dropped', () => {
    setPhone(false);
    const h = handlers();
    render(<CRMKanbanPipeline leads={LEADS} {...h} />);
    dropOn('won', '1');
    expect(h.onStageChange).toHaveBeenCalledWith(1, 'won');
    h.onStageChange.mockClear();
    dropOn('qualified', '2');
    dropOn('lost', 'نه یک شناسه');
    expect(h.onStageChange).not.toHaveBeenCalled();
  });

  it('shows the next follow-up on the card, in red when it has passed', () => {
    setPhone(false);
    const { container } = render(<CRMKanbanPipeline leads={LEADS} {...handlers()} />);
    const overdue = within(container.querySelector('[data-pipeline-lead="2"]') as HTMLElement).getByTitle('پیگیری گذشته است');
    expect(overdue.className).toContain('text-rose-600');
    expect(within(container.querySelector('[data-pipeline-lead="3"]') as HTMLElement).queryByTitle('پیگیری بعدی')).toBeNull();
  });

  it('offers delete in the card menu only with a delete handler', () => {
    setPhone(false);
    const { container, rerender } = render(<CRMKanbanPipeline leads={[lead(1, 'lead')]} {...handlers()} />);
    fireEvent.click(within(container.querySelector('[data-pipeline-lead="1"]') as HTMLElement).getByTitle('کارهای پرونده'));
    expect(screen.queryByRole('button', { name: 'حذف پرونده' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    const onDeleteLead = vi.fn();
    rerender(<CRMKanbanPipeline leads={[lead(1, 'lead')]} {...handlers()} onDeleteLead={onDeleteLead} />);
    fireEvent.click(within(container.querySelector('[data-pipeline-lead="1"]') as HTMLElement).getByTitle('کارهای پرونده'));
    fireEvent.click(screen.getByRole('button', { name: 'حذف پرونده' }));
    expect(onDeleteLead).toHaveBeenCalledWith(1);
  });

  it('shows one stage behind a tab on a phone, with its count, and no dragging', () => {
    setPhone(true);
    const { container } = render(<CRMKanbanPipeline leads={LEADS} {...handlers()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(container.querySelectorAll('[data-pipeline-stage]')).toHaveLength(1);
    fireEvent.click(container.querySelector('[data-pipeline-tab="qualified"]') as HTMLElement);
    expect(container.querySelector('[data-pipeline-stage="qualified"]')).not.toBeNull();
    expect(container.querySelector('[data-pipeline-tab="qualified"]')?.textContent).toContain('۲');
    expect(container.querySelector('[data-pipeline-lead="2"]')?.getAttribute('draggable')).toBe('false');
  });
});
