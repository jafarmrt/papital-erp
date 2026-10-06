import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KardexWacDifferencesPanel } from '../../components/inventory/KardexWacDifferencesPanel';
import { wacDifferencesOf } from '../../lib/inventoryAudit/wacCorrection';

// Package 6 WAC correction (TD-487 / B06-08, decision t3): after a Kardex rebuild the items whose WAC differs from the
// Kardex replay are listed; only a holder of inventory.wac_correct gets the «اصلاح بها» button, which posts
// /inventory/correct-wac after a Persian confirmation.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));
let canCorrect = false;
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => canCorrect && key === 'inventory.wac_correct' }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const ROWS = wacDifferencesOf({
  wacDiffers: true, itemId: 9, itemCode: 'A-9', itemName: 'سنگ فیروزه', newStock: 10, oldWac: 150, replayWac: 100, valueDifference: -500,
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  confirmAction.mockReset();
  canCorrect = false;
});

describe('Kardex WAC differences after a rebuild (TD-487)', () => {
  it('builds the difference row from a single-item rebuild and nothing from a matching one', () => {
    expect(ROWS).toEqual([{ itemId: 9, itemCode: 'A-9', itemName: 'سنگ فیروزه', stock: 10, recordedWac: 150, replayWac: 100, valueDifference: -500 }]);
    expect(wacDifferencesOf({ wacDiffers: false, itemId: 9 })).toEqual([]);
  });

  it('lists the item without a correction button for a user without the permission', () => {
    render(<KardexWacDifferencesPanel rows={ROWS} />);
    expect(screen.getByText('سنگ فیروزه')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'اصلاح بها' })).toBeNull();
  });

  it('corrects the WAC through POST /inventory/correct-wac after confirmation', async () => {
    canCorrect = true;
    confirmAction.mockResolvedValue(true);
    fetchJson.mockResolvedValue({ success: true, message: 'ok' });
    const onCorrected = vi.fn();
    render(<KardexWacDifferencesPanel rows={ROWS} onCorrected={onCorrected} />);
    fireEvent.click(screen.getByRole('button', { name: 'اصلاح بها' }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/inventory/correct-wac', { method: 'POST', body: JSON.stringify({ itemId: 9 }) }));
    expect(String(confirmAction.mock.calls[0][0].message)).toContain('کسری و اضافات انبار');
    await waitFor(() => expect(screen.getByText('اصلاح شد')).toBeTruthy());
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });
});
