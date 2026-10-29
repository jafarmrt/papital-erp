import { describe, expect, it } from 'vitest';
import { recordAttachmentRefusal, recordAttachmentRuleText } from '../../lib/attachments/recordAttachments';

describe('add-attachment rule (v11)', () => {
  it('adds and removes before approval, only adds after, and nothing in a closed year', () => {
    const draft = { approved: false, yearClosed: false };
    const approved = { approved: true, yearClosed: false };
    const closed = { approved: true, yearClosed: true };
    expect(recordAttachmentRefusal(draft, 'add')).toBeNull();
    expect(recordAttachmentRefusal(draft, 'remove')).toBeNull();
    expect(recordAttachmentRefusal(approved, 'add')).toBeNull();
    expect(recordAttachmentRefusal(approved, 'remove')).toContain('تأیید شده');
    expect(recordAttachmentRefusal(closed, 'add')).toContain('سال مالی');
    expect(recordAttachmentRefusal({ approved: false, yearClosed: true }, 'remove')).toContain('سال مالی');
    expect(recordAttachmentRuleText(draft)).toContain('بردارید');
    expect(recordAttachmentRuleText(approved)).toContain('برداشته نمی‌شود');
  });
});
