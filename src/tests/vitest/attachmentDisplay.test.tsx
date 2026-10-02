import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setAuthToken } from '../../api';
import { FinancialAttachmentViewerModal } from '../../components/accounting/FinancialAttachmentViewerModal';
import { VoucherAttachmentThumbnails } from '../../components/accounting/VoucherAttachmentThumbnails';
import type { FinancialAttachment } from '../../types';

// TD-224 (بند ۲): تصویر و دانلود پیوست در حالت توکن در حافظه (کوکی مسدود) با هدر Bearer؛ TD-236: پیش‌نمایش پیوست سند حسابداری.
const ATT_URL = '/api/attachments/3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f';
const attachment: FinancialAttachment = { id: 'a1', name: 'factor.png', url: ATT_URL, type: 'image/png', size: 10 };

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:attachment-1');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(['png'], { type: 'image/png' }))));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  setAuthToken(null);
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

function bearerHeaderOf(call: unknown[]): string | undefined {
  return ((call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('attachment images and downloads with the in-memory token (TD-224 part 2)', () => {
  it('loads a protected attachment image with the Bearer header and shows it from a blob URL', async () => {
    setAuthToken('preview-token');
    render(<FinancialAttachmentViewerModal attachment={attachment} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByAltText('factor.png').getAttribute('src')).toBe('blob:attachment-1'));
    expect(fetchMock).toHaveBeenCalledWith(ATT_URL, expect.objectContaining({ credentials: 'include' }));
    expect(bearerHeaderOf(fetchMock.mock.calls[0])).toBe('Bearer preview-token');
  });

  it('downloads a protected attachment with the Bearer header', async () => {
    setAuthToken('preview-token');
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    render(<FinancialAttachmentViewerModal attachment={attachment} onClose={() => undefined} />);
    fireEvent.click(screen.getByTitle('دانلود فایل'));
    await waitFor(() => expect(clicked).toEqual(['blob:attachment-1']));
    expect(fetchMock.mock.calls.every(c => bearerHeaderOf(c) === 'Bearer preview-token')).toBe(true);
    click.mockRestore();
  });

  it('keeps the plain URL (cookie session) when no token is held in memory', () => {
    render(<FinancialAttachmentViewerModal attachment={attachment} onClose={() => undefined} />);
    expect(screen.getByAltText('factor.png').getAttribute('src')).toBe(ATT_URL);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('journal voucher attachment thumbnails (TD-236)', () => {
  it('shows the image and name of an attachment stored with name/url/type', () => {
    render(<VoucherAttachmentThumbnails attachments={[attachment, { id: 'a2', name: 'statement.pdf', url: ATT_URL.replace('6f', '70'), type: 'application/pdf' }]} onOpen={() => undefined} />);
    expect(screen.getByAltText('factor.png').getAttribute('src')).toBe(ATT_URL);
    expect(screen.getAllByText('statement.pdf').length).toBeGreaterThan(0);
  });

  it('still reads the pre-v7.0.56 fileName/dataUrl/fileType fields', () => {
    render(<VoucherAttachmentThumbnails attachments={[{ id: 'a3', name: '', url: '', fileName: 'old.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', fileType: 'image/jpeg' }]} onOpen={() => undefined} />);
    expect(screen.getByAltText('old.jpg').getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
  });
});
