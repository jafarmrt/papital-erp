import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { PieceworkLogModal } from '../../components/piecework/PieceworkLogModal';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import type { PieceworkLog } from '../../types';

// v10.0.20 (D-11, plan MOBILE_WORKSHOP_PLAN.md section 3.2): the piecework entry form on a phone. The window takes the
// whole screen with its body scrolling between a fixed header and footer, the edit fields are one column, the quantity
// field opens the decimal keypad (hours keep the text keyboard for «:»), and the save waits for the connection.

const ROW = { taskId: '' as const, projectId: '' as const, quantity: '', unitRate: '' };

function renderForm(overrides: Partial<ComponentProps<typeof PieceworkLogModal>> = {}) {
  const props: ComponentProps<typeof PieceworkLogModal> = {
    isOpen: true, onClose: () => undefined, onSubmit: (e) => e.preventDefault(), editingLog: null, setEditingLog: vi.fn(),
    selectedPersonnelForLog: '', setSelectedPersonnelForLog: vi.fn(), defaultBatchProjectId: '', setDefaultBatchProjectId: vi.fn(),
    logDate: '1405/07/18', setLogDate: vi.fn(), batchLogRows: [ROW as never], setBatchLogRows: vi.fn(), tasksList: [],
    personnelSelectOptions: [], projectSelectOptions: [], taskSelectOptions: [], onTaskChangeInRow: vi.fn(),
    onAddLogRow: vi.fn(), onRemoveLogRow: vi.fn(), ...overrides,
  };
  render(<QueryClientProvider client={new QueryClient()}><PieceworkLogModal {...props} /></QueryClientProvider>);
}

const classesOf = (element: Element | null) => element?.getAttribute('class') ?? '';
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'ذخیره کارکرد' });

afterEach(() => {
  cleanup();
  act(() => { window.dispatchEvent(new Event('online')); });
});

describe('piecework entry form on a phone (D-11)', () => {
  it('opens over the whole phone screen', () => {
    renderForm();
    const panel = screen.getByRole('dialog', { name: 'ثبت گروهی کارکرد روزانه پرسنل' });
    expect(classesOf(panel)).toContain(PHONE_SHEET_PANEL);
    expect(classesOf(panel.parentElement)).toContain(PHONE_SHEET_OVERLAY);
    expect(classesOf(saveButton())).toContain(PHONE_TAP_TARGET);
  });

  it('opens the decimal keypad for a quantity', () => {
    renderForm();
    expect(screen.getByRole('textbox', { name: /تعداد \/ مقدار/ }).getAttribute('inputmode')).toBe('decimal');
  });

  it('puts the edit fields in one column on a phone', () => {
    const log = { id: 3, personnelName: 'رضا', date: '2026-10-09', unit: 'عدد', quantity: 4, unitRate: 1000 } as unknown as PieceworkLog;
    renderForm({ editingLog: log });
    const quantity = screen.getByRole('textbox', { name: /تعداد \/ کارکرد/ });
    expect(quantity.getAttribute('inputmode')).toBe('decimal');
    expect(classesOf(quantity.closest('.grid'))).toContain('grid-cols-1 sm:grid-cols-2');
  });

  it('does not save while the phone is offline', () => {
    renderForm();
    expect(saveButton().disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute('title')).toBe(OFFLINE_SUBMIT_TITLE);
  });
});
