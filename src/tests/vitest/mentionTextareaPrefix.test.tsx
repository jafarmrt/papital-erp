import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MentionTextarea } from '../../components/MentionTextarea';
import { detectMentionedUserIds } from '../../lib/mentions/mentionDetection';

// v9.0.232 (TD-628, finding B13-03): a mention is the longest name after «@» at a word boundary, never a name prefix
const users = [
  { id: 1, username: 'ali', full_name: 'علی' },
  { id: 2, username: 'alireza', full_name: 'علی رضایی' },
  { id: 3, username: 'mohammad', full_name: 'محمد' },
];

afterEach(cleanup);

describe('mention detection (TD-628)', () => {
  it('"@Ali Rezaei" (Persian full name) mentions only that user, not the prefix name "Ali"', () => {
    const onMentionsChange = vi.fn();
    render(<MentionTextarea value="@علی رضایی لطفاً پیگیری کن" onChange={() => {}} users={users} mentions={[]} onMentionsChange={onMentionsChange} />);
    expect(onMentionsChange).toHaveBeenLastCalledWith([2]);
  });

  it('a name glued to more letters (ZWNJ included) is not a mention of the shorter name', () => {
    expect(detectMentionedUserIds('@علی‌رضا و @محمدرضا', users)).toEqual([]);
    expect(detectMentionedUserIds('@محمد، @علی.', users)).toEqual([3, 1]);
  });

  it('a mention removed from the text leaves the list, and usernames count', () => {
    const onMentionsChange = vi.fn();
    render(<MentionTextarea value="@alireza بررسی شد" onChange={() => {}} users={users} mentions={[1, 2]} onMentionsChange={onMentionsChange} />);
    expect(onMentionsChange).toHaveBeenLastCalledWith([2]);
  });
});
