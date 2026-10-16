import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  MESSENGER_BODY_MAX_CHARS, MESSENGER_PREFERENCE_CATEGORIES, messengerLinkPath, messengerMessageWithLink, messengerNotificationText,
  NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, notificationAbsoluteLink, type NotificationCategory,
} from '../../lib/notifications/notificationCategories';
import { deadLetterDeliveryJobId } from '../../services/events/deadLetterDelivery';
import { nextAttemptDelaySeconds } from '../../services/events/integrationDelivery.service';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): every in-app notification is written by `createNotifications`,
 * which queues its messenger jobs in the same transaction, so no production file outside it inserts into `notifications`.
 * Before, eight places wrote the bell row themselves and nothing reached Bale or Telegram. The messenger text is personal,
 * in Persian digits, without the text of an administrator's rule template, and carries the app's own link.
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const CREATOR = 'src/services/notifications/notificationCreator.ts';
const ALLOWED = (rel: string) => rel === CREATOR || rel.startsWith('src/tests/') || rel.startsWith('src/db/');
const DRIZZLE_INSERT = /\.insert\(\s*(?:schema\.)?notifications\s*\)/g;
const SQL_INSERT = /\binsert\s+into\s+"?notifications"?/gi;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function notificationWriters(): string[] {
  const found: string[] = [];
  for (const file of productionFiles(SRC)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of [DRIZZLE_INSERT, SQL_INSERT]) {
      for (const match of text.matchAll(pattern)) {
        found.push(`${rel}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  return found;
}

describe('notifications are written only through createNotifications (messenger plan part 2)', () => {
  it('no production file outside the creator inserts into notifications', () => {
    expect(notificationWriters()).toEqual([]);
  });

  it('the scan sees a direct insert', () => {
    expect('await tx.insert(notifications).values({})'.match(DRIZZLE_INSERT)).toHaveLength(1);
    expect('INSERT INTO notifications (user_id) VALUES (1)'.match(SQL_INSERT)).toHaveLength(1);
  });
});

describe('messenger text of a notification', () => {
  it('a full-text category greets the recipient by name, says what it is about and writes Persian digits', () => {
    const text = messengerNotificationText({
      recipientName: 'زهرا احمدی', category: 'workflow_sla', title: 'مهلت کار تاییدی گذشت', message: 'مهلت «بررسی» برای 12 به پایان رسید.',
    });
    expect(text.split('\n')).toEqual(['زهرا احمدی،', 'مهلت کار تاییدی گذشت', 'مهلت «بررسی» برای ۱۲ به پایان رسید.']);
  });

  it('every other category, a future one included, sends only its fixed sentence, never the typed title or a name', () => {
    for (const category of NOTIFICATION_CATEGORIES.filter(c => c !== 'workflow_sla')) {
      const text = messengerNotificationText({ recipientName: 'رضا', category, title: 'پرونده شرکت آلفا 1500000', message: 'علی رضایی در «سفارش 15» اشاره کرد' });
      expect(text.split('\n')[0]).toBe('رضا،');
      expect(text).not.toMatch(/آلفا|علی|سفارش|1500000|۱۵۰۰۰۰۰|15|۱۵/);
    }
    expect(messengerNotificationText({ recipientName: 'x', category: 'payslip', title: 'فیش 9', message: 'خالص 500' })).toBe('x،\nفیش حقوق شما تأیید شد.');
    const future = messengerNotificationText({ recipientName: 'x', category: 'unknown_future' as NotificationCategory, title: 'مبلغ 9', message: 'مبلغ 9' });
    expect(future).toBe('x،\nاعلان تازه‌ای در برنامه پاپیتال برای شما آمده است.');
  });

  it('a generic category links to its section page only; an automatic rule links to the first page', () => {
    expect(messengerLinkPath('mention', '/daily-logs?id=5')).toBe('/daily-logs');
    expect(messengerLinkPath('crm_won', '/crm?leadId=7')).toBe('/crm');
    expect(messengerLinkPath('event_rule', '/accounting/vouchers?amount=1500000')).toBe('/');
    expect(messengerLinkPath('crm_followup', '/payroll?id=3')).toBe('/');
    expect(messengerLinkPath('workflow_sla', '/approval-inbox')).toBe('/approval-inbox');
  });

  it('the profile offers only categories some code writes yet', () => {
    expect(MESSENGER_PREFERENCE_CATEGORIES).not.toContain('payslip');
    expect(MESSENGER_PREFERENCE_CATEGORIES).not.toContain('workflow_task');
    expect(MESSENGER_PREFERENCE_CATEGORIES).toContain('mention');
  });

  it('a 429 waits at least its retry_after, at most an hour', () => {
    expect(nextAttemptDelaySeconds(1)).toBe(5);
    expect(nextAttemptDelaySeconds(1, 120)).toBe(120);
    expect(nextAttemptDelaySeconds(6, 2)).toBe(160);
    expect(nextAttemptDelaySeconds(1, 99999)).toBe(3600);
  });

  it('a messenger dead letter is replayed as its own delivery', () => {
    expect(deadLetterDeliveryJobId({ source: 'messenger', metadata: { deliveryJobId: 7 } })).toBe(7);
    expect(deadLetterDeliveryJobId({ source: 'outbox_worker', metadata: { deliveryJobId: 7 } })).toBeNull();
  });

  it('never sends the text of an automatic rule, whose template may hold an amount', () => {
    const text = messengerNotificationText({ recipientName: 'رضا', category: 'event_rule', title: 'فاکتور 1500000 ریال', message: 'مبلغ 1500000' });
    expect(text).not.toMatch(/1500000|۱۵۰۰۰۰۰|ریال|مبلغ/);
    expect(text).toContain('رضا،');
  });

  it('clips a long body and drops a body equal to the title', () => {
    const long = messengerNotificationText({ recipientName: 'x', category: 'workflow_sla', title: 't', message: 'ب'.repeat(2000) });
    expect(long.split('\n')[2].length).toBe(MESSENGER_BODY_MAX_CHARS);
    expect(messengerNotificationText({ recipientName: 'x', category: 'workflow_sla', title: 'همان', message: 'همان' }).split('\n')).toHaveLength(2);
  });

  it('links to the app address only when both the address and the path are known', () => {
    expect(notificationAbsoluteLink('https://erp.papitalgallery.com/', '/daily-logs?id=5')).toBe('https://erp.papitalgallery.com/daily-logs?id=5');
    expect(notificationAbsoluteLink(undefined, '/crm')).toBe('');
    expect(notificationAbsoluteLink('erp.example', '/crm')).toBe('');
    expect(notificationAbsoluteLink('https://erp.papitalgallery.com', '')).toBe('');
    expect(messengerMessageWithLink('سلام', '')).toBe('سلام');
    expect(messengerMessageWithLink('سلام', 'https://a.b/c')).toBe('سلام\n\nدیدن در برنامه:\nhttps://a.b/c');
  });

  it('every category has a Persian label', () => {
    for (const category of NOTIFICATION_CATEGORIES) expect(NOTIFICATION_CATEGORY_LABELS[category]).toMatch(/[\u0600-\u06FF]/);
  });
});
