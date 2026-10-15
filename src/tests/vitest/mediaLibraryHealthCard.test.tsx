import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MediaLibraryHealthCard } from '../../components/system/MediaLibraryHealthCard';
import {
  MEDIA_DISK_LOW_BYTES, MEDIA_LIBRARY_HEALTH_MESSAGES, MEDIA_REBUILD_LIGHT_COMMAND, formatByteSize, isDiskLow, mediaLibraryVerdict,
  type MediaLibraryHealth,
} from '../../lib/system/mediaLibraryHealth';

// v10.1.3 (N-05 PR 4): the health page shows the media library: its files, their size, free disk space and the
// images whose light version must be rebuilt. Before, the page had no media library card at all.

afterEach(cleanup);

const GB = 1024 ** 3;
const healthy: MediaLibraryHealth = {
  status: 'ok', path: '/opt/papital-erp/media-library', fileCount: 12, imageCount: 10, videoCount: 2,
  originalBytes: 3 * GB / 2, lightBytes: 40 * 1024 * 1024, thumbBytes: 2 * 1024 * 1024, lightFailedCount: 0, lightMissingCount: 0,
  diskFreeBytes: 50 * GB, diskTotalBytes: 100 * GB, messages: [MEDIA_LIBRARY_HEALTH_MESSAGES.ok],
};

/** Text of the card without its technical details (paths, the terminal command), which may be Latin */
function plainText(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-technical]').forEach(el => el.remove());
  return copy.textContent ?? '';
}

describe('media library health card (N-05 PR 4)', () => {
  it('shows the counts, sizes and free space in Persian digits', () => {
    const { container } = render(<MediaLibraryHealthCard media={healthy} />);
    const card = container.querySelector('[data-testid="media-library-health"]') as HTMLElement;
    expect(card.dataset.status).toBe('ok');
    expect(container.querySelector('[data-field="files"]')?.textContent).toBe('۱۲ (۱۰ عکس، ۲ فیلم)');
    expect(container.querySelector('[data-field="original"]')?.textContent).toBe('۱٫۵ گیگابایت');
    expect(container.querySelector('[data-field="light"]')?.textContent).toBe('۴۲ مگابایت');
    expect(container.querySelector('[data-field="disk"]')?.textContent).toBe('۵۰ گیگابایت از ۱۰۰ گیگابایت');
    expect(plainText(container)).not.toMatch(/[A-Za-z0-9]/);
    expect(container.textContent).not.toContain(MEDIA_REBUILD_LIGHT_COMMAND);
  });

  it('warns about light versions to rebuild and gives the command only among the technical details', () => {
    const figures = { ...healthy, lightFailedCount: 2, lightMissingCount: 3 };
    const verdict = mediaLibraryVerdict(figures);
    expect(verdict.status).toBe('warning');
    const { container } = render(<MediaLibraryHealthCard media={{ ...figures, ...verdict }} />);
    expect((container.querySelector('[data-testid="media-library-health"]') as HTMLElement).dataset.status).toBe('warning');
    expect(container.textContent).toContain('نسخه سبک ۲ تصویر ساخته نشد');
    expect(container.textContent).toContain('۳ تصویر هنوز نسخه سبک ندارد');
    expect(container.querySelector('[data-technical]')?.textContent).toBe(MEDIA_REBUILD_LIGHT_COMMAND);
    expect(plainText(container)).not.toMatch(/[A-Za-z0-9]/);
  });

  it('warns about low free disk space and reads an unknown disk without a warning', () => {
    expect(isDiskLow(MEDIA_DISK_LOW_BYTES - 1, 1000 * GB)).toBe(true);
    expect(isDiskLow(8 * GB, 100 * GB)).toBe(true);
    expect(isDiskLow(20 * GB, 100 * GB)).toBe(false);
    const low = mediaLibraryVerdict({ lightFailedCount: 0, lightMissingCount: 0, diskFreeBytes: 2 * GB, diskTotalBytes: 100 * GB });
    expect(low.status).toBe('warning');
    expect(low.messages[0]).toContain('فضای آزاد دیسک کتابخانه کم است (۲ گیگابایت)');
    const unknownDisk = mediaLibraryVerdict({ lightFailedCount: 0, lightMissingCount: 0, diskFreeBytes: null, diskTotalBytes: null });
    expect(unknownDisk).toEqual({ status: 'ok', messages: [MEDIA_LIBRARY_HEALTH_MESSAGES.diskUnknown] });
  });

  it('never shows an unread answer as zeros', () => {
    const { container } = render(<MediaLibraryHealthCard media={undefined} />);
    expect((container.querySelector('[data-testid="media-library-health"]') as HTMLElement).dataset.status).toBe('unknown');
    expect(container.querySelector('[data-field="files"]')?.textContent).toContain('نامعلوم');
    expect(container.textContent).not.toContain('۰');
  });

  it('formats byte sizes with Persian units', () => {
    expect(formatByteSize(512)).toBe('۵۱۲ بایت');
    expect(formatByteSize(1536)).toBe('۱٫۵ کیلوبایت');
    expect(formatByteSize(2 * 1024 ** 4)).toBe('۲ ترابایت');
  });
});
