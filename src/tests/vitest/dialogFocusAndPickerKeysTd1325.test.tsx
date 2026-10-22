import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { DialogLayer } from '../../components/common/DialogLayer';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ModernPersianDropzone } from '../../components/common/ModernPersianDropzone';
import { AuditDiffViewer } from '../../components/audit/AuditDiffViewer';
import { AuditPrintModal } from '../../components/audit/AuditPrintModal';
import { AppLayout } from '../../components/layout/AppLayout';
import { openDialogFocusCount } from '../../lib/a11y/dialogFocus';
import { displayClockNow } from '../../utils';
import type { User } from '../../types';

// TD-1325 (OBS-R1-37, OBS-R2-93, OBS-R1-35): an open window keeps Tab inside and gives focus back when it closes; the
// pick list works with the keyboard and its Esc closes only the list; a pasted file is read once; the menu search folds
// text like the other searches; the audit change table names its fields, an edit's snapshot is not called «پیش از حذف»
// and the print time is the business time zone's.

vi.mock('../../api', () => ({ fetchJson: () => Promise.resolve({}) }));

const BEFORE_DELETE_TITLE = 'تصویر داده رکورد پیش از حذف:';
const NAME_LABEL = 'نام';
// «طرفین حساب» typed with the Arabic «ي» and without its space
const CUSTOMERS_MENU_TYPED = 'طرفينحساب';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ModalWithOpener({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      <Modal isOpen={open} onClose={() => { setOpen(false); onClose?.(); }} title="window">
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    </div>
  );
}

describe('dialog_focus_and_picker_keys_td_1325', () => {
  it('a window keeps Tab inside and gives focus back to its opener when it closes', () => {
    render(<ModalWithOpener />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(openDialogFocusCount()).toBe(1);

    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    const tab = fireEvent.keyDown(last, { key: 'Tab' });
    expect(tab).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);

    const back = fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true });
    expect(back).toBe(false);
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openDialogFocusCount()).toBe(0);
    expect(document.activeElement).toBe(opener);
  });

  it('a hand-built window keeps the field that took focus itself', () => {
    render(
      <div role="dialog" aria-modal="true" aria-label="hand-built">
        <DialogLayer onClose={() => undefined} />
        <input aria-label="field" autoFocus />
      </div>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('field'));
  });

  it('the pick list moves with the arrow keys, picks with Enter and closes on Esc without closing the window', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="window">
        <SearchableSelect
          id="pick"
          value=""
          onChange={onPick}
          options={[{ value: 1, label: 'سیب' }, { value: 2, label: 'گلابی', disabled: true }, { value: 3, label: 'هلو' }]}
        />
      </Modal>,
    );
    const button = document.getElementById('pick') as HTMLButtonElement;
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/option-2$/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('3', undefined);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    const reopened = screen.getByRole('combobox');
    fireEvent.keyDown(reopened, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a file pasted inside the box is read once', async () => {
    const onChange = vi.fn();
    const { container } = render(<ModernPersianDropzone attachments={[]} onChange={onChange} />);
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }] },
    });
    const box = container.querySelector('div[tabindex="0"]') as HTMLElement;
    await act(async () => {
      box.dispatchEvent(paste);
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the menu search finds an item typed with Arabic letters and without its space', async () => {
    const user: User = { id: 7, username: 'worker', full_name: 'کارکن', role: 'custom_role' };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/']}>
          <AppLayout user={user} userPermissions={{ permissions: ['customers.view'], isAdmin: false }} onLogout={() => undefined}
            onUserUpdate={() => undefined} isProfileModalOpen={false} setIsProfileModalOpen={() => undefined}
            isSidebarCollapsed={false} toggleSidebar={() => undefined}>
            <div />
          </AppLayout>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('جست‌وجوی فهرست...'), { target: { value: CUSTOMERS_MENU_TYPED } });
    const found = Array.from(document.querySelectorAll('a')).some(link => link.getAttribute('href') === '/customers');
    expect(found).toBe(true);
  });

  it('the audit change table names its fields and an edit snapshot is not a delete', () => {
    const { unmount } = render(<AuditDiffViewer action="UPDATE" details={{ changes: { name: { before: 'a', after: 'b' } } }} />);
    expect(screen.getByTitle('name').textContent).toBe(NAME_LABEL);
    unmount();
    render(<AuditDiffViewer action="UPDATE" details={{ before: { name: 'a' }, after: { name: 'a' } }} />);
    expect(screen.queryByText(BEFORE_DELETE_TITLE)).toBeNull();
  });

  it('the audit print shows the business time zone clock', () => {
    render(<AuditPrintModal logs={[]} total={0} onClose={() => undefined} filterSummary={{}} />);
    expect(document.body.textContent ?? '').toContain(displayClockNow().dateLabel);
  });
});
