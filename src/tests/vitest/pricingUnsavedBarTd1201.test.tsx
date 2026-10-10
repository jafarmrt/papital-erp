import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { UnsavedPriceEditsBar } from '../../components/pricing/UnsavedPriceEditsBar';

/**
 * v10.0.102 (TD-1201): the pricing page's «ذخیره یکجای تمام تغییرات» bar no longer floats `fixed` over the first card's
 * save button; it is `sticky` in the page flow after the list, so it never hides a card button at the end of the page.
 */
describe('TD-1201 unsaved price edits bar', () => {
  afterEach(cleanup);

  it('is sticky in the page flow, never fixed over the cards', () => {
    render(<UnsavedPriceEditsBar count={2} isSaving={false} onCancel={() => {}} onSaveAll={() => {}} />);
    const bar = screen.getByTestId('unsaved-price-edits-bar');
    expect(bar.className.split(/\s+/)).toContain('sticky');
    expect(bar.className.split(/\s+/)).not.toContain('fixed');
  });

  it('shows nothing without edits and saves or cancels on its buttons', () => {
    const onSaveAll = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<UnsavedPriceEditsBar count={0} isSaving={false} onCancel={onCancel} onSaveAll={onSaveAll} />);
    expect(screen.queryByTestId('unsaved-price-edits-bar')).toBeNull();
    rerender(<UnsavedPriceEditsBar count={3} isSaving={false} onCancel={onCancel} onSaveAll={onSaveAll} />);
    fireEvent.click(screen.getByRole('button', { name: /ذخیره یکجای تمام تغییرات/ }));
    fireEvent.click(screen.getByRole('button', { name: 'انصراف' }));
    expect(onSaveAll).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is the bar the pricing page renders, with no fixed bottom bar left in the page', () => {
    const page = readFileSync('src/pages/PricingPage.tsx', 'utf8');
    expect(page).toContain('<UnsavedPriceEditsBar');
    expect(page).not.toMatch(/fixed bottom-/);
  });
});
