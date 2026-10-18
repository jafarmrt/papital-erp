import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ORPHAN_UPLOAD_NAME_PATTERN, orphanUploadsMessage, uploadNamesIn, type OrphanUploadsReport,
} from '../../lib/system/orphanUploads';

// v10.2.17 (OBS-R2-60, 10.2 package 13): a replaced image stayed in public/uploads for ever. «پاک کردن تصویرهای بی‌صاحب»
// counts first and removes only after a confirmation; only the names the image fields write are candidates.

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));

afterEach(() => { cleanup(); fetchJson.mockReset(); confirmAction.mockReset(); });

const report = (over: Partial<OrphanUploadsReport> = {}): OrphanUploadsReport => ({
  dryRun: true, scannedFiles: 10, referencedFiles: 7, recentFiles: 1,
  orphans: { files: 2, bytes: 3 * 1024 * 1024, removed: 0, names: [] }, failures: [], ...over,
});

describe('orphan_uploads_obs_r2_60: removing images no record names', () => {
  it('candidates are only the names the image fields write', () => {
    expect(ORPHAN_UPLOAD_NAME_PATTERN.test('3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.png')).toBe(true);
    expect(ORPHAN_UPLOAD_NAME_PATTERN.test('logo-3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.webp')).toBe(true);
    for (const other of ['brand.png', '3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.pdf', '3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.light.webp', '.attachments']) {
      expect(ORPHAN_UPLOAD_NAME_PATTERN.test(other)).toBe(false);
    }
    expect(uploadNamesIn('{"img":"/uploads/A.png","t":"https://x/uploads/b.jpg"}')).toEqual(['a.png', 'b.jpg']);
  });

  it('the sentences are Persian with Persian digits', () => {
    for (const r of [report(), report({ dryRun: false, orphans: { files: 2, bytes: 2048, removed: 2, names: [] } }), report({ orphans: { files: 0, bytes: 0, removed: 0, names: [] } })]) {
      expect(orphanUploadsMessage(r)).not.toMatch(/[A-Za-z0-9]/);
    }
    expect(orphanUploadsMessage(report())).toContain('۲ تصویر (۳ مگابایت)');
  });

  it('the card counts first and removes only after the confirmation', async () => {
    const { OrphanUploadsCard } = await import('../../components/settings/OrphanUploadsCard');
    fetchJson.mockResolvedValueOnce({ ...report(), message: orphanUploadsMessage(report()) });
    render(<OrphanUploadsCard />);
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'پاک کردن تصویرهای بی‌صاحب' });
    expect(remove.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'بررسی تصویرها' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('۲ تصویر'));
    expect(JSON.parse(String(fetchJson.mock.calls[0][1].body))).toEqual({ apply: false });

    confirmAction.mockResolvedValueOnce(false);
    fireEvent.click(remove);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(fetchJson).toHaveBeenCalledTimes(1);

    confirmAction.mockResolvedValueOnce(true);
    fetchJson.mockResolvedValueOnce(report({ dryRun: false, orphans: { files: 2, bytes: 10, removed: 2, names: [] } }));
    fireEvent.click(remove);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchJson.mock.calls[1][1].body))).toEqual({ apply: true });
  });
});
