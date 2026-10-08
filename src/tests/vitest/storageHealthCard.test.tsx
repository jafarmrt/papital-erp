import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StorageHealthCard } from '../../components/system/StorageHealthCard';
import { STORAGE_LOCATION_MESSAGES } from '../../lib/system/storageHealth';

// v9.0.359 (TD-619, B01-39): the storage card shows each directory the app writes to (attachments and images) with its
// own state; on v9.0.358 it showed only public/uploads and said «دسترسی کامل» while attachments could not be saved.

afterEach(cleanup);

describe('storage health card (TD-619)', () => {
  it('shows an unwritable attachment directory as an error next to a writable image directory', () => {
    const { container } = render(<StorageHealthCard storage={{
      status: 'error', writable: false, message: '',
      locations: [
        { kind: 'attachments', path: '/srv/erp/attachments', writable: false, message: STORAGE_LOCATION_MESSAGES.attachments.error },
        { kind: 'images', path: '/srv/erp/public/uploads', writable: true, message: STORAGE_LOCATION_MESSAGES.images.ok },
      ],
    }} />);
    const card = container.querySelector('[data-status]') as HTMLElement;
    expect(card.dataset.status).toBe('error');
    expect(card.textContent).toContain('خطای دسترسی');
    expect(container.querySelector('[data-kind="attachments"]')?.getAttribute('data-writable')).toBe('no');
    expect(container.querySelector('[data-kind="attachments"]')?.textContent).toContain('پیوست تازه ذخیره نمی‌شود');
    expect(container.querySelector('[data-kind="images"]')?.getAttribute('data-writable')).toBe('yes');
    expect(card.textContent).toContain('/srv/erp/attachments');
  });

  it('never reads an answer without directories as writable', () => {
    const { container } = render(<StorageHealthCard storage={undefined} />);
    expect((container.querySelector('[data-status]') as HTMLElement).dataset.status).toBe('error');
    expect(container.textContent).not.toContain('قابل نوشتن');
  });
});
