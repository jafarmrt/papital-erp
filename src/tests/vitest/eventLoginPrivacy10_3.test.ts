/**
 * 10.3 package 5 (decisions ت۴۷ items 3 and 5): the cheque status event no longer carries the amount or the party name,
 * so the rule editor stops offering them, a rule is tried without them, and the health check and the boot log read the
 * rules that still do; the settings notice goes to the messenger only as a fixed sentence; and the previous token of the
 * device that closed its other devices is accepted only for that device, that version pair and that minute.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventFieldOptions } from '../../lib/eventPayloadFields';
import { CHEQUE_PRIVATE_FIELDS } from '../../lib/events/ruleMissingField';
import { messengerNotificationText, messengerLinkPath, MESSENGER_PREFERENCE_CATEGORIES } from '../../lib/notifications/notificationCategories';
import { privateFieldUseOf } from '../../services/accounting/treasuryRuleFieldHealth';
import { rulesOnMissingNumericFields } from '../../services/events/ruleMissingFieldLog';
import { ruleSampleEvent } from '../../services/events/ruleSampleEvent';
import {
  TOKEN_VERSION_GRACE_MS, allowPreviousTokenVersion, clearTokenVersionGraceForTests, previousTokenVersionAccepted,
} from '../../services/auth/tokenVersionGrace';

describe('cheque_event_privacy_10_3_package5', () => {
  it('the rule editor offers no amount or party name for the cheque event, and a rule on it is tried without the amount', () => {
    const paths = eventFieldOptions('ChequeStatusChanged').map(f => f.path);
    expect(paths).toContain('payload.newStatus');
    expect(paths).toContain('payload.partyId');
    expect(paths).not.toContain('payload.amount');
    expect(paths).not.toContain('payload.partyName');
    expect(ruleSampleEvent('ChequeStatusChanged').payload).not.toHaveProperty('amount');
    expect(ruleSampleEvent('InvoiceApproved').payload).toHaveProperty('amount');
  });

  it('reads a cheque rule on the amount or the party name, and a «*» rule only on the party name', () => {
    const cheque = CHEQUE_PRIVATE_FIELDS.ChequeStatusChanged;
    expect(privateFieldUseOf([{ field: 'payload.amount', operator: 'gt', value: 1 }], {}, cheque)?.use).toBe('never_matches');
    expect(privateFieldUseOf([{ field: 'event.payload.partyName', operator: 'neq', value: 'x' }], {}, cheque)?.use).toBe('always_matches');
    expect(privateFieldUseOf([], { messageTemplate: 'طرف {{payload.partyName}}' }, CHEQUE_PRIVATE_FIELDS['*'])).toEqual({ fields: ['payload.partyName'], use: 'text_only' });
    expect(privateFieldUseOf([{ field: 'payload.amount', operator: 'gt', value: 1 }], {}, CHEQUE_PRIVATE_FIELDS['*'])).toBeNull();
    expect(privateFieldUseOf([{ field: 'payload.newStatus', operator: 'eq', value: 'passed' }], {}, cheque)).toBeNull();
  });

  it('the boot log names a cheque rule whose numeric comparison reads the amount', () => {
    const rows = rulesOnMissingNumericFields([
      { id: 1, eventType: 'ChequeStatusChanged', conditionsJson: [{ field: 'payload.amount', operator: 'gte', value: 1 }] },
      { id: 2, eventType: 'ChequeStatusChanged', conditionsJson: [{ field: 'payload.chequeId', operator: 'gt', value: 0 }] },
      { id: 3, eventType: 'TreasuryTransactionApproved', conditionsJson: [{ field: 'payload.amount', operator: 'gt', value: 0 }] },
    ]);
    expect(rows.map(r => r.ruleId)).toEqual([1, 3]);
  });
});

describe('settings_change_notice_10_3_package5', () => {
  it('may be kept out of the messenger, which gets a fixed sentence without the amount and opens the settings page', () => {
    expect(MESSENGER_PREFERENCE_CATEGORIES).toContain('settings_change');
    const text = messengerNotificationText({ category: 'settings_change', recipientName: 'مدیر', title: 'تغییر آستانه', message: 'از ۵۰۰٬۰۰۰٬۰۰۰ به ۷۰۰٬۰۰۰٬۰۰۰ ریال' });
    expect(text).not.toMatch(/۵۰۰|۷۰۰|500|700/);
    expect(messengerLinkPath('settings_change', '/settings')).toBe('/settings');
  });
});

describe('token_version_grace_10_3_package5', () => {
  afterEach(() => { vi.useRealTimers(); clearTokenVersionGraceForTests(); });

  it('accepts the previous version only from the same device, for the same raise, inside the minute', () => {
    vi.useFakeTimers();
    const claims = { id: 7, sid: 'device-a' };
    allowPreviousTokenVersion(claims, 3, 4);
    expect(previousTokenVersionAccepted(claims, 3, 4)).toBe(true);
    expect(previousTokenVersionAccepted({ id: 7, sid: 'device-b' }, 3, 4)).toBe(false);
    expect(previousTokenVersionAccepted({ id: 8, sid: 'device-a' }, 3, 4)).toBe(false);
    expect(previousTokenVersionAccepted(claims, 2, 4)).toBe(false);
    expect(previousTokenVersionAccepted(claims, 3, 5)).toBe(false);
    vi.advanceTimersByTime(TOKEN_VERSION_GRACE_MS);
    expect(previousTokenVersionAccepted(claims, 3, 4)).toBe(false);
  });

  it('keys a token without sid by its legacy session key', () => {
    const legacy = { id: 9, csrfToken: 'csrf-legacy' };
    allowPreviousTokenVersion(legacy, 0, 1);
    expect(previousTokenVersionAccepted({ id: 9, csrfToken: 'csrf-legacy' }, 0, 1)).toBe(true);
    expect(previousTokenVersionAccepted({ id: 9, csrfToken: 'csrf-other' }, 0, 1)).toBe(false);
  });
});
