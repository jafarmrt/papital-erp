import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionMenu } from '../../components/ActionMenu';
import { actionMenuPosition, ACTION_MENU_WIDTH } from '../../lib/ui/actionMenuPosition';

afterEach(cleanup);

// v10.0.x (TD-1238): منوی «⋮» ردیف جدول (دفتر چک) نباید با overflow جدول بریده شود
describe('row action menu opens above the table (TD-1238)', () => {
  it('the open menu is not inside the clipping table box and keeps every item', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <div data-testid="table-box" style={{ overflow: 'hidden', height: 40 }}>
        <ActionMenu items={[{ label: 'تغییر وضعیت چک', onClick: () => undefined }, { label: 'کپی شماره چک', onClick: onCopy }, { label: 'حذف چک', onClick: () => undefined }]} />
      </div>
    );
    fireEvent.click(screen.getByTitle('عملیات بیشتر'));
    const box = container.querySelector('[data-testid="table-box"]') as HTMLElement;
    const item = screen.getByText('کپی شماره چک');
    expect(box.contains(item)).toBe(false);
    expect(screen.getByRole('menu').className).toContain('fixed');
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('حذف چک')).toBeNull();
  });

  it('opens below the button, above it near the page bottom, and stays inside the page width', () => {
    const viewport = { width: 400, height: 600 };
    expect(actionMenuPosition({ top: 100, bottom: 120, left: 50, right: 70 }, 3, 'left', viewport)).toEqual({ left: 50, top: 124 });
    const low = actionMenuPosition({ top: 560, bottom: 580, left: 50, right: 70 }, 3, 'left', viewport);
    expect(low).toEqual({ left: 50, bottom: 44 });
    expect(actionMenuPosition({ top: 100, bottom: 120, left: 380, right: 395 }, 1, 'left', viewport).left).toBe(400 - ACTION_MENU_WIDTH - 8);
    expect(actionMenuPosition({ top: 100, bottom: 120, left: 5, right: 20 }, 1, 'right', viewport).left).toBe(8);
  });
});
