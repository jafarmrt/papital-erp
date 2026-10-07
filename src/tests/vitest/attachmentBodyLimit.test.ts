import { describe, expect, it } from 'vitest';
import { ATTACHMENT_BODY_LIMIT, MAX_ATTACHMENT_FILE_MB, acceptsAttachmentBody } from '../../lib/attachments/attachmentBodyLimit';

// v9.0.255 (TD-641, finding B13-16): only the save routes of records with attachments take the larger body
describe('attachment body limit routes', () => {
  it('accepts the larger body only on save routes of records with attachments', () => {
    expect(acceptsAttachmentBody('POST', '/api/documents')).toBe(true);
    expect(acceptsAttachmentBody('put', '/api/documents/12?x=1')).toBe(true);
    expect(acceptsAttachmentBody('POST', '/api/accounting/vouchers')).toBe(true);
    expect(acceptsAttachmentBody('POST', '/api/accounting/treasury')).toBe(true);
    expect(acceptsAttachmentBody('POST', '/api/accounting/cheques')).toBe(true);
    expect(acceptsAttachmentBody('PUT', '/api/projects/7')).toBe(true);
    expect(acceptsAttachmentBody('POST', '/api/daily-logs')).toBe(false);
    expect(acceptsAttachmentBody('GET', '/api/documents')).toBe(false);
    expect(acceptsAttachmentBody('POST', '/api/documents/12/finalize')).toBe(false);
    expect(acceptsAttachmentBody('POST', '/api/items/import')).toBe(false);
  });

  it('fits one file at the per-file limit as a data URL', () => {
    const dataUrlBytes = Math.ceil((MAX_ATTACHMENT_FILE_MB * 1024 * 1024) / 3) * 4 + 64;
    expect(dataUrlBytes).toBeLessThan(parseInt(ATTACHMENT_BODY_LIMIT, 10) * 1024 * 1024);
  });
});
