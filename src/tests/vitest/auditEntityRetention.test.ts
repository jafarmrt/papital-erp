/**
 * v9.0.212 (TD-522, B02-07, owner decision t4 A): the audit purge deletes only operational sections and never a
 * financial, security, role or user event. Every entity name production code writes into activity_logs (logActivity,
 * a direct insert, a migration) must be classified as critical or purgeable in `src/lib/audit/auditRetention.ts`, and
 * both lists hold only names the code really writes. A new entity name fails here until it is classified.
 */
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_AUDIT_ENTITIES,
  CRITICAL_AUDIT_ENTITY_PREFIXES,
  PURGEABLE_AUDIT_ENTITIES,
  PURGEABLE_AUDIT_ENTITY_LABELS,
} from '../../lib/audit/auditRetention';
import { codeAuditWrites, migrationAuditWrites } from './support/auditWriteScan';

/** entity values that are runtime data, not code: an event rule's audit category is typed by the admin */
const RUNTIME_ENTITY_EXPRESSIONS = new Set(['auditConfig.category']);

const critical = new Set<string>(CRITICAL_AUDIT_ENTITIES);
const purgeable = new Set<string>(PURGEABLE_AUDIT_ENTITIES);

describe('audit entity retention (TD-522)', () => {
  const uses = [...codeAuditWrites('entity', RUNTIME_ENTITY_EXPRESSIONS), ...migrationAuditWrites('entity')];
  const writtenNames = new Set(uses.flatMap(u => u.names));
  const writtenHeads = new Set(uses.flatMap(u => u.heads));

  it('finds the audit writes of the code', () => {
    expect(uses.length).toBeGreaterThan(140);
    expect(writtenNames).toContain('journal_voucher');
    expect(writtenNames).toContain('ترنسفر');
    expect(writtenNames).toContain('نقش و دسترسی');
  });

  it('resolves every entity a production write uses', () => {
    const unresolved = uses.filter(u => u.unresolved.length > 0).map(u => `${u.file}:${u.line} ${u.unresolved.join(' | ')}`);
    expect(unresolved).toEqual([]);
  });

  it('classifies every written entity name exactly once', () => {
    const unclassified = [...writtenNames].filter(n => !critical.has(n) && !purgeable.has(n)).sort();
    expect(unclassified).toEqual([]);
    expect(PURGEABLE_AUDIT_ENTITIES.filter(n => critical.has(n))).toEqual([]);
  });

  it('keeps every variable entity name under a critical prefix', () => {
    const unknownHeads = [...writtenHeads].filter(h => !CRITICAL_AUDIT_ENTITY_PREFIXES.some(p => h.startsWith(p))).sort();
    expect(unknownHeads).toEqual([]);
    expect(PURGEABLE_AUDIT_ENTITIES.filter(n => CRITICAL_AUDIT_ENTITY_PREFIXES.some(p => n.startsWith(p)))).toEqual([]);
  });

  it('lists only names and prefixes the code really writes', () => {
    expect([...CRITICAL_AUDIT_ENTITIES, ...PURGEABLE_AUDIT_ENTITIES].filter(n => !writtenNames.has(n))).toEqual([]);
    expect(CRITICAL_AUDIT_ENTITY_PREFIXES.filter(p => ![...writtenHeads].some(h => h.startsWith(p)))).toEqual([]);
  });

  it('keeps the financial names of the finding (R09) and labels every purgeable section in Persian', () => {
    for (const name of ['account', 'journal_voucher', 'cheque', 'bank_account', 'treasury_transaction', 'treasury_transfer',
      'پرداخت حقوق', 'اسناد انبار', 'طرف حساب', 'فیش حقوقی', 'نقش و دسترسی', 'کاربران سیستم', 'احراز هویت']) {
      expect(critical.has(name), name).toBe(true);
    }
    for (const name of PURGEABLE_AUDIT_ENTITIES) {
      expect(PURGEABLE_AUDIT_ENTITY_LABELS[name]).toMatch(/^[؀-ۿ‌ ]+$/);
    }
  });
});
