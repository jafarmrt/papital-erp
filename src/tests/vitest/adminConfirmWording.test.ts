// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import * as userRestore from '../../lib/users/userRestore';
import { EVENT_QUEUE_CONFIRMATIONS } from '../../components/system/EventQueueActions';

const ROOT = path.resolve(__dirname, '../../..');

// v10.0.39 (TD-1162): a deleted user can be restored, so the delete confirmation never says it cannot be undone.
describe('user_delete_confirm_mentions_restore_td_1162: the user delete confirmation tells how to restore', () => {
  it('the users page confirms with the shared message, which names the restore path', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src/pages/UsersPage.tsx'), 'utf8');
    expect(page).not.toMatch(/غیر ?قابل بازگشت/);
    const message = String((userRestore as Record<string, unknown>).DELETE_USER_CONFIRM_MESSAGE ?? '');
    expect(page).toContain('message={DELETE_USER_CONFIRM_MESSAGE}');
    expect(message).toMatch(/بازگرد/);
    expect(message).toMatch(/همان نام کاربری/);
  });
});

// v10.0.38 (TD-1166): retrying failed events skips completed handlers and webhook deliveries that succeeded.
describe('event_requeue_confirm_skips_done_work_td_1166: the retry confirmation says only failed parts run again', () => {
  it('does not claim every webhook, notification and workflow runs again', () => {
    const { message } = EVENT_QUEUE_CONFIRMATIONS.requeue_dlq(3);
    expect(message).not.toMatch(/هم دوباره اجرا می‌شوند/);
    expect(message).toMatch(/فقط بخش‌های ناموفق/);
  });
});
