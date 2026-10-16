import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  MESSENGER_BODY_MAX_CHARS, messengerMessageWithLink, messengerNotificationText, NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS, notificationAbsoluteLink,
} from '../../lib/notifications/notificationCategories';

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
  it('greets the recipient by name, says what it is about and writes Persian digits', () => {
    const text = messengerNotificationText({
      recipientName: 'زهرا احمدی', category: 'mention', title: 'اشاره در گزارش کار روزانه', message: 'علی در گزارش 12 به شما اشاره کرد.',
    });
    expect(text.split('\n')).toEqual(['زهرا احمدی،', 'اشاره در گزارش کار روزانه', 'علی در گزارش ۱۲ به شما اشاره کرد.']);
  });

  it('never sends the text of an automatic rule, whose template may hold an amount', () => {
    const text = messengerNotificationText({ recipientName: 'رضا', category: 'event_rule', title: 'فاکتور 1500000 ریال', message: 'مبلغ 1500000' });
    expect(text).not.toMatch(/1500000|۱۵۰۰۰۰۰|ریال|مبلغ/);
    expect(text).toContain('رضا،');
  });

  it('clips a long body and drops a body equal to the title', () => {
    const long = messengerNotificationText({ recipientName: 'x', category: 'crm_followup', title: 't', message: 'ب'.repeat(2000) });
    expect(long.split('\n')[2].length).toBe(MESSENGER_BODY_MAX_CHARS);
    expect(messengerNotificationText({ recipientName: 'x', category: 'crm_won', title: 'همان', message: 'همان' }).split('\n')).toHaveLength(2);
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
