/**
 * Hand-built windows have a role, a name and close on Esc, topmost first (v10.1.28, TD-1277).
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { dialogGapsOfSource, repositoryDialogGaps } from '../../../scripts/dialog-roles';
import { DialogLayer } from '../../components/common/DialogLayer';
import { TreasuryVoidModal } from '../../components/accounting/treasury/TreasuryVoidModal';
import type { TreasuryTransaction } from '../../types';
import { Modal } from '../../components/common/Modal';
import { openDialogEscapeCount } from '../../lib/a11y/dialogEscapeStack';

const PROBE = `
export const Probe = ({ onClose }: { onClose: () => void }) => (
  <>
    <div className="fixed inset-0 bg-black/50"><div className="panel"><h3>عنوان</h3></div></div>
    <div role="dialog" aria-modal="true" className="fixed inset-0"><DialogLayer onClose={onClose} /><h3>عنوان</h3></div>
    <div role="dialog" className="fixed inset-0"><DialogLayer onClose={onClose} /><p>متن</p></div>
    <div className="fixed inset-0"><div role="dialog" aria-modal="true" aria-label="پنجره"><p>متن</p></div></div>
    <div aria-hidden="true" className="fixed inset-0 bg-black/50" />
    <div role="alertdialog" aria-modal="true" aria-label="هشدار" className="fixed inset-0" />
  </>
);
`;

const FIRST = 'پنجره نخست';
const SECOND = 'پنجره دوم';

function Window({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0">
      <DialogLayer onClose={onClose} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Stacked({ onFirstClose, onSecondClose }: { onFirstClose: () => void; onSecondClose: () => void }) {
  const [second, setSecond] = useState(true);
  return (
    <Window title={FIRST} onClose={onFirstClose}>
      {second && (
        <Window
          title={SECOND}
          onClose={() => {
            onSecondClose();
            setSecond(false);
          }}
        />
      )}
    </Window>
  );
}

describe('dialog_roles_td_1277', () => {
  afterEach(cleanup);

  it('the scanner finds a window without role, modal flag, name or Esc and accepts complete ones', () => {
    const gaps = dialogGapsOfSource(PROBE, 'src/components/Probe.tsx');
    expect(gaps.map((gap) => `${gap.line} ${gap.problem}`)).toEqual(['4 no-role', '6 not-modal', '6 no-name', '7 no-escape']);
  });

  it('every hand-built window in the browser code has a role, a name and Esc', () => {
    const gaps = repositoryDialogGaps();
    expect(gaps.map((gap) => `${gap.file}:${gap.line} ${gap.problem}`)).toEqual([]);
  }, 60_000);

  it('a window without a label is named by its heading', () => {
    render(<Window title={FIRST} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: FIRST })).toBeTruthy();
  });

  it('Esc closes only the topmost window, then the one under it', () => {
    const onFirstClose = vi.fn();
    const onSecondClose = vi.fn();
    const { unmount } = render(<Stacked onFirstClose={onFirstClose} onSecondClose={onSecondClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSecondClose).toHaveBeenCalledTimes(1);
    expect(onFirstClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onFirstClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(openDialogEscapeCount()).toBe(0);
  });

  it('Esc taken by a control inside the window closes nothing', () => {
    const onClose = vi.fn();
    render(
      <div role="dialog" aria-modal="true" aria-label={FIRST}>
        <DialogLayer onClose={onClose} />
        <input aria-label="جست‌وجو" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText('جست‌وجو'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a window that is saving closes neither itself nor the window under it on Esc', () => {
    const onUnderClose = vi.fn();
    const onSavingClose = vi.fn();
    render(
      <Window title={FIRST} onClose={onUnderClose}>
        <div role="dialog" aria-modal="true" aria-label={SECOND}>
          <DialogLayer onClose={onSavingClose} disabled />
        </div>
      </Window>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSavingClose).not.toHaveBeenCalled();
    expect(onUnderClose).not.toHaveBeenCalled();
  });

  it('the treasury void window ignores Esc while its void request is running, and closes on Esc after', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    const target = { id: 7, transactionNumber: 'TR-7', amount: 1000, bankAccountTitle: 'صندوق' } as unknown as TreasuryTransaction;
    const { rerender } = render(<TreasuryVoidModal target={target} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'مبلغ اشتباه' } });
    fireEvent.click(screen.getByRole('button', { name: 'ابطال با سند معکوس' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    rerender(<TreasuryVoidModal target={{ ...target, id: 8 } as TreasuryTransaction} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a shared Modal opened over a hand-built window takes Esc first', () => {
    const onWindowClose = vi.fn();
    const onModalClose = vi.fn();
    const { unmount } = render(
      <Window title={FIRST} onClose={onWindowClose}>
        <Modal isOpen onClose={onModalClose} title={SECOND}>
          <p>متن</p>
        </Modal>
      </Window>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onModalClose).toHaveBeenCalledTimes(1);
    expect(onWindowClose).not.toHaveBeenCalled();
    unmount();
  });
});
