import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  isHoldOver, ORPHAN_UPLOAD_HELD_PATTERN, ORPHAN_UPLOAD_NAME_PATTERN, orphanUploadsMessage, UPLOAD_UUID_PATTERN_SOURCE,
  uploadUuidOf, uploadUuidsIn, type OrphanUploadsReport,
} from '../../lib/system/orphanUploads';

// v10.2.18 (OBS-R2-60, 10.2 package 13): a replaced image stayed in public/uploads for ever. «پاک کردن تصویرهای بی‌صاحب»
// checks first and, after a confirmation, moves aside only the files the check listed; only the names the image fields
// write are candidates, and a file is kept when its UUID appears anywhere in a row (the server reads the rows with the
// same pattern, UPLOAD_UUID_PATTERN_SOURCE).

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));

afterEach(() => { cleanup(); fetchJson.mockReset(); confirmAction.mockReset(); });

const report = (over: Partial<OrphanUploadsReport> = {}): OrphanUploadsReport => ({
  dryRun: true, scannedFiles: 10, referencedFiles: 7, recentFiles: 1,
  orphans: { files: 2, bytes: 3 * 1024 * 1024, moved: 0, names: ['a.png', 'b.png'] }, heldFiles: 3,
  expired: { files: 1, bytes: 10, removed: 0, names: ['2026-09-01/c.png'] }, restored: { files: 0, moved: 0 },
  skipped: 0, failures: [], failureCount: 0, ...over,
});
const none = { files: 0, bytes: 0, moved: 0, names: [] };
const noExpired = { files: 0, bytes: 0, removed: 0, names: [] };

describe('orphan_uploads_obs_r2_60: removing images no record names', () => {
  it('candidates are only the names the image fields write', () => {
    expect(ORPHAN_UPLOAD_NAME_PATTERN.test('3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.png')).toBe(true);
    expect(ORPHAN_UPLOAD_NAME_PATTERN.test('logo-3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.webp')).toBe(true);
    for (const other of ['brand.png', '3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.pdf', '3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.light.webp', '.attachments']) {
      expect(ORPHAN_UPLOAD_NAME_PATTERN.test(other)).toBe(false);
    }
    expect(ORPHAN_UPLOAD_HELD_PATTERN.test('2026-10-19/3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.png')).toBe(true);
    expect(ORPHAN_UPLOAD_HELD_PATTERN.test('../3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.png')).toBe(false);
    expect(uploadUuidOf('logo-3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba.webp')).toBe('3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba');
  });

  it('a reference is the UUID wherever it stands, the way the server reads rows', () => {
    const u = '3f2fc9fe-d789-5cfe-aa2d-db5e0ac95fba';
    const forms = [
      `دیدن /uploads/${u}.png.`, `/uploads/${u}.png_`, `/Uploads/${u.toUpperCase()}.png`, `%2Fuploads%2F${u}.png`,
      `uploads\\/${u}.png`, `${u}.png`, `{"img":"https://x/uploads/${u}.png"}`,
    ];
    for (const text of forms) expect(uploadUuidsIn(text)).toEqual([u]);
    expect(uploadUuidsIn('no image here')).toEqual([]);
    expect(UPLOAD_UUID_PATTERN_SOURCE).not.toMatch(/[\\^$]/);
  });

  it('a held file is past the hold after thirty days', () => {
    expect(isHoldOver('2026-09-19', '2026-10-19')).toBe(true);
    expect(isHoldOver('2026-09-20', '2026-10-19')).toBe(false);
  });

  it('the sentences are Persian with Persian digits', () => {
    const run = report({ dryRun: false, orphans: { ...none, files: 2, moved: 2 }, expired: { ...noExpired, removed: 1 }, skipped: 1, failureCount: 1 });
    for (const r of [report(), run, report({ orphans: none, expired: noExpired })]) {
      expect(orphanUploadsMessage(r)).not.toMatch(/[A-Za-z0-9]/);
    }
    expect(orphanUploadsMessage(report())).toContain('۲ تصویر (۳ مگابایت)');
    expect(orphanUploadsMessage(report())).toContain('پوشهٔ جدا منتقل می‌شود؛ بعد از ۳۰ روز پاک می‌شود');
  });

  it('the card checks first and runs only on the checked files after the confirmation', async () => {
    const { OrphanUploadsCard } = await import('../../components/settings/OrphanUploadsCard');
    fetchJson.mockResolvedValueOnce({ ...report(), message: orphanUploadsMessage(report()) });
    render(<OrphanUploadsCard />);
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'جابه‌جایی تصویرهای بی‌صاحب' });
    expect(remove.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'بررسی تصویرها' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('۲ تصویر'));
    expect(JSON.parse(String(fetchJson.mock.calls[0][1].body))).toEqual({ apply: false });

    confirmAction.mockResolvedValueOnce(false);
    fireEvent.click(remove);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(fetchJson).toHaveBeenCalledTimes(1);

    confirmAction.mockResolvedValueOnce(true);
    let finish: (v: unknown) => void = () => undefined;
    fetchJson.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(remove);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchJson.mock.calls[1][1].body))).toEqual({ apply: true, quarantine: ['a.png', 'b.png'], purge: ['2026-09-01/c.png'] });
    expect(screen.getByRole('button', { name: 'بررسی تصویرها' }).textContent).toBe('بررسی تصویرها');
    expect(remove.textContent).toBe('در حال اجرا...');
    finish(report({ dryRun: false, orphans: { ...none, files: 2, moved: 2 } }));
    await waitFor(() => expect(remove.textContent).toBe('جابه‌جایی تصویرهای بی‌صاحب'));
  });
});
