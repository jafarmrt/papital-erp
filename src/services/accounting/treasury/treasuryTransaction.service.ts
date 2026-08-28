import { orm } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions } from '../../../db/schema.js';
import { eq, desc, and, sql, gte, lte } from 'drizzle-orm';
import { ChartOfAccountsService } from '../chartOfAccounts.service.js';
import { VoucherService } from '../voucher.service.js';
import { validateLockOrder, LockHierarchyLevel } from '../../../lib/lockOrder.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { DomainEventType } from '../../events/domainEvents.js';
import { OutboxService } from '../../events/outboxService.js';
import { fin } from '../../../lib/financialDecimal.js';
import type { TreasuryTransaction } from '../../../types.js';
import { NotFoundError, ValidationError } from '../../../errors/customErrors.js';

export class TreasuryTransactionService {
  static async generateTransactionNumber(type: 'receipt' | 'payment', tx?: any): Promise<string> {
    const executor = tx || orm;
    const result = await executor.execute(sql`SELECT nextval('treasury_tx_number_seq') AS num`);
    const seqNum = Number(result.rows?.[0]?.num);
    const prefix = type === 'receipt' ? 'REC' : 'PAY';
    return `${prefix}-${String(seqNum).padStart(6, '0')}`;
  }

  static async getTreasuryTransactions(params: {
    type?: 'receipt' | 'payment';
    bankAccountId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<TreasuryTransaction[]> {
    const conditions = [eq(treasuryTransactions.isDeleted, 0)];

    if (params.type) {
      conditions.push(eq(treasuryTransactions.type, params.type));
    }
    if (params.bankAccountId) {
      conditions.push(eq(treasuryTransactions.bankAccountId, params.bankAccountId));
    }
    if (params.startDate) {
      conditions.push(gte(treasuryTransactions.date, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(treasuryTransactions.date, params.endDate));
    }

    const rawList = await orm.select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      type: treasuryTransactions.type,
      date: treasuryTransactions.date,
      method: treasuryTransactions.method,
      amount: treasuryTransactions.amount,
      currency: treasuryTransactions.currency,
      exchangeRate: treasuryTransactions.exchangeRate,
      bankAccountId: treasuryTransactions.bankAccountId,
      bankAccountTitle: bankAccounts.title,
      partyType: treasuryTransactions.partyType,
      partyId: treasuryTransactions.partyId,
      partyName: treasuryTransactions.partyName,
      trackingNumber: treasuryTransactions.trackingNumber,
      voucherId: treasuryTransactions.voucherId,
      chequeId: treasuryTransactions.chequeId,
      documentId: treasuryTransactions.documentId,
      description: treasuryTransactions.description,
      status: treasuryTransactions.status,
      createdAt: treasuryTransactions.createdAt,
    })
    .from(treasuryTransactions)
    .leftJoin(bankAccounts, eq(bankAccounts.id, treasuryTransactions.bankAccountId))
    .where(and(...conditions))
    .orderBy(desc(treasuryTransactions.date), desc(treasuryTransactions.id));

    return rawList.map(t => ({
      ...t,
      type: t.type as 'receipt' | 'payment',
      method: t.method as TreasuryTransaction['method'],
      partyType: t.partyType as TreasuryTransaction['partyType'],
      status: t.status as TreasuryTransaction['status'],
      transaction_number: t.transactionNumber,
      bank_account_id: t.bankAccountId || undefined,
      party_type: t.partyType as TreasuryTransaction['partyType'],
      party_id: t.partyId,
      party_name: t.partyName,
      tracking_number: t.trackingNumber || '',
      voucher_id: t.voucherId,
      cheque_id: t.chequeId,
      document_id: t.documentId,
    }));
  }

  static async createTreasuryTransaction(data: {
    type: 'receipt' | 'payment';
    date: string;
    method: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
    amount: number;
    currency?: string;
    exchangeRate?: number;
    bankAccountId: number;
    partyType?: 'customer' | 'personnel' | 'supplier' | 'other';
    partyId?: number | null;
    partyName: string;
    trackingNumber?: string;
    documentId?: number | null;
    description?: string;
    userId?: number;
    username?: string;
    createVoucher?: boolean;
  }): Promise<TreasuryTransaction> {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) throw new ValidationError('مبلغ تراکنش باید بزرگتر از صفر باشد');

    return await orm.transaction(async (txEngine) => {
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      ]);
      const [bank] = await txEngine.select().from(bankAccounts).where(eq(bankAccounts.id, data.bankAccountId)).for('update');
      if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');

      const txNum = await this.generateTransactionNumber(data.type, txEngine);

      // V9-1.3: محاسبه موجودی بانک با FinancialDecimal — حذف خطای شناور float
      const currentBal = Number(bank.currentBalance) || 0;
      const newBal = data.type === 'receipt'
        ? fin(currentBal).add(amount).round(4).toNumber()
        : fin(currentBal).subtract(amount).round(4).toNumber();
      await txEngine.update(bankAccounts).set({ currentBalance: newBal }).where(eq(bankAccounts.id, data.bankAccountId));

      let voucherId: number | null = null;
      if (data.createVoucher !== false) {
        if (!bank.accountId) {
          throw new ValidationError('حساب معین مرتبط در چارت حساب‌ها برای این حساب بانکی/صندوق تعریف نشده است');
        }

        const allAccs = await ChartOfAccountsService.getAllAccounts(txEngine);
        let contraAccountId: number | null = null;

        if (data.partyType === 'customer') {
          contraAccountId = allAccs.find(a => a.code === '1201')?.id || null;
        } else if (data.partyType === 'personnel') {
          contraAccountId = allAccs.find(a => a.code === '3201')?.id || null;
        } else if (data.partyType === 'supplier') {
          contraAccountId = allAccs.find(a => a.code === '3001')?.id || null;
        } else {
          contraAccountId = allAccs.find(a => a.code === '1201' || a.code === '3001')?.id || null;
        }

        if (!contraAccountId) {
          throw new NotFoundError('حساب معین طرف حساب در چارت حساب‌ها یافت نشد');
        }

        const descText = data.description || `${data.type === 'receipt' ? 'دریافت' : 'پرداخت'} ${data.method === 'cash' ? 'نقدی' : data.method === 'pos' ? 'کارتخوان' : 'حواله بانکی'} از/به ${data.partyName}`;
        
        const debitAccountId = data.type === 'receipt' ? bank.accountId : contraAccountId;
        const creditAccountId = data.type === 'receipt' ? contraAccountId : bank.accountId;

        const v = await VoucherService.createJournalVoucher({
          date: data.date,
          voucherType: 'treasury',
          description: descText,
          referenceModule: 'treasury',
          referenceNumber: txNum,
          currency: data.currency || bank.currency || 'IRR',
          userId: data.userId,
          username: data.username,
          items: [
            {
              accountId: debitAccountId,
              detailedType: data.type === 'receipt' ? 'bank_account' : (data.partyType || 'other'),
              detailedId: data.type === 'receipt' ? bank.id : data.partyId,
              detailedName: data.type === 'receipt' ? bank.title : data.partyName,
              debit: amount,
              credit: 0,
              currency: data.currency || 'IRR',
              description: descText,
            },
            {
              accountId: creditAccountId,
              detailedType: data.type === 'receipt' ? (data.partyType || 'other') : 'bank_account',
              detailedId: data.type === 'receipt' ? data.partyId : bank.id,
              detailedName: data.type === 'receipt' ? data.partyName : bank.title,
              debit: 0,
              credit: amount,
              currency: data.currency || 'IRR',
              description: descText,
            }
          ]
        }, txEngine);
        voucherId = v.id;
      }

      const [tx] = await txEngine.insert(treasuryTransactions).values({
        transactionNumber: txNum,
        type: data.type,
        date: data.date.trim(),
        method: data.method,
        amount,
        currency: data.currency || bank.currency || 'IRR',
        exchangeRate: Number(data.exchangeRate) || 1,
        bankAccountId: data.bankAccountId,
        partyType: data.partyType || 'other',
        partyId: data.partyId || null,
        partyName: data.partyName.trim(),
        trackingNumber: data.trackingNumber?.trim() || '',
        voucherId,
        documentId: data.documentId || null,
        description: data.description?.trim() || '',
        status: 'completed',
        createdById: data.userId || null,
      }).returning();

      // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with treasury transaction)
      const treasuryEvent = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(tx.id),
        {
          transactionId: tx.id,
          type: data.type === 'receipt' ? 'deposit' : 'withdrawal',
          amount,
          currency: data.currency || bank.currency || 'IRR',
          accountId: bank.id,
          accountName: bank.title,
          description: data.description
        },
        { userId: data.userId, userName: data.username }
      );
      await OutboxService.saveToOutbox(txEngine, treasuryEvent);

      return {
        ...tx,
        type: tx.type as 'receipt' | 'payment',
        method: tx.method as TreasuryTransaction['method'],
        partyType: tx.partyType as TreasuryTransaction['partyType'],
        status: tx.status as TreasuryTransaction['status'],
        bankAccountTitle: bank.title,
      };
    });
  }
}
