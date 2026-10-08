import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { orm } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions } from '../../../db/schema.js';
import { ConflictError, NotFoundError } from '../../../errors/customErrors.js';
import { logActivity } from '../../../lib/auditLogger.js';
import { LockHierarchyLevel, validateLockOrder } from '../../../lib/lockOrder.js';
import { assertTreasuryDocumentLink, resolveTreasuryPartyName } from './treasuryLinks.js';

/**
 * v9.0.272 (TD-779، تصمیم ت۴ «الف» بسته ۸): دریافت یا پرداخت ثبت‌شده خزانه از سندش جدا («علی‌الحساب») یا به سند فعال
 * دیگری وصل می‌شود. سند حسابداری ردیف دست نمی‌خورد، چون مشتری یا تأمین‌کننده در هر دو حالت همان مبلغ را بستانکار یا
 * بدهکار شده است؛ فقط جمع تسویه دو سند عوض می‌شود. فاکتوری که دریافت زنده دارد باطل نمی‌شود (`assertVoidHasNoTreasuryRows`)
 * و این مسیر راه کاربر برای جدا کردن آن دریافت است.
 *
 * قفل‌ها به ترتیب سطح: حساب بانکی (۱۰)، سند تازه `FOR SHARE` (۶۰، در `assertTreasuryDocumentLink`)، ردیف خزانه (۸۰).
 * سند تازه همان قاعده ثبت دریافت را دارد (TD-501): فعال، هم‌سو، با همان طرف حساب؛ و ارز آن همان ارز ردیف است (از v9.0.452،
 * TD-908، همین سنجش در `assertTreasuryDocumentLink` و برای ثبت هم).
 */

export interface TreasuryDocumentRelinkResult {
  id: number;
  documentId: number | null;
  previousDocumentId: number | null;
  changed: boolean;
}

export async function relinkTreasuryDocument(params: {
  id: number;
  documentId: number | null;
  req?: Request;
  userId?: number;
  username?: string;
}): Promise<TreasuryDocumentRelinkResult> {
  return orm.transaction(async (tx) => {
    validateLockOrder([
      { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      ...(params.documentId ? [{ name: 'document', hierarchyLevel: LockHierarchyLevel.DOCUMENTS }] : []),
      { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
    ]);
    const [peek] = await tx.select({ bankAccountId: treasuryTransactions.bankAccountId }).from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.id, params.id), eq(treasuryTransactions.isDeleted, 0)));
    if (!peek) throw new NotFoundError('تراکنش خزانه یافت نشد');
    if (peek.bankAccountId) {
      await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.id, peek.bankAccountId)).for('update');
    }

    const [before] = await tx.select().from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.id, params.id), eq(treasuryTransactions.isDeleted, 0)));
    if (!before) throw new NotFoundError('تراکنش خزانه یافت نشد');

    if (params.documentId !== null) {
      const partyName = await resolveTreasuryPartyName(tx, before.partyType || 'other', before.partyId);
      await assertTreasuryDocumentLink(tx, {
        type: before.type === 'payment' ? 'payment' : 'receipt',
        documentId: params.documentId,
        partyType: before.partyType || 'other',
        partyId: before.partyId ?? null,
        partyName: partyName ?? before.partyName,
        // v9.0.452 (TD-908): سنجش ارز همان قاعده ثبت است (`assertTreasuryDocumentLink`)
        currency: before.currency,
      });
    }

    const [row] = await tx.select().from(treasuryTransactions)
      .where(and(eq(treasuryTransactions.id, params.id), eq(treasuryTransactions.isDeleted, 0)))
      .for('update');
    if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
    if (row.status !== 'completed' || row.reversalOfId !== null) {
      throw new ConflictError('تراکنش باطل‌شده یا ردیف ابطال تراکنش دیگر به سندی وصل یا از آن جدا نمی‌شود.', undefined, 'TREASURY_ROW_NOT_RELINKABLE');
    }
    if (row.payrollId) {
      throw new ConflictError('پرداخت حقوق به فیش خودش بسته است و به سند دیگری وصل نمی‌شود.', undefined, 'TREASURY_ROW_NOT_RELINKABLE');
    }
    const previousDocumentId = row.documentId ?? null;
    if (previousDocumentId === params.documentId) {
      return { id: row.id, documentId: previousDocumentId, previousDocumentId, changed: false };
    }

    await tx.update(treasuryTransactions)
      .set({ documentId: params.documentId, version: (row.version ?? 1) + 1, updatedAt: sql`now()` })
      .where(eq(treasuryTransactions.id, row.id));
    await logActivity({
      tx,
      req: params.req,
      userId: params.userId,
      username: params.username,
      action: 'UPDATE',
      entity: 'treasury_transaction',
      entityId: String(row.id),
      description: params.documentId === null
        ? `جدا کردن تراکنش ${row.transactionNumber} از سند شماره ${previousDocumentId} (علی‌الحساب)`
        : `انتقال تراکنش ${row.transactionNumber} از ${previousDocumentId ? `سند شماره ${previousDocumentId}` : 'علی‌الحساب'} به سند شماره ${params.documentId}`,
      details: { before: { documentId: previousDocumentId }, after: { documentId: params.documentId } },
    });
    return { id: row.id, documentId: params.documentId, previousDocumentId, changed: true };
  });
}
