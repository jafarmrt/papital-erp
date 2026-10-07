import { orm, type DbExecutor } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { eq, asc, and } from 'drizzle-orm';
import { STANDARD_CHART_OF_ACCOUNTS } from '../../data/standardChartOfAccounts.js';
import { logger } from '../../middleware/logger.js';
import type { Account, AccountLevel, AccountType, AccountNature } from '../../types.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { countAccountVoucherRows } from './accountPostings.js';
import { assertAccountPlacement } from './accountPlacement.js';
import { assertAccountCodeAvailable, guardAccountCode, requireAccountCode } from './accountCodeGuard.js';
import { isValidAccountCode, normalizeAccountCode } from '../../lib/accounting/accountCode.js';

export class ChartOfAccountsService {
  /**
   * Seed standard Chart of Accounts if empty or missing system accounts
   */
  static async seedStandardAccounts(): Promise<{ seededCount: number }> {
    const existing = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
    const existingCodes = new Set(existing.map(a => a.code));

    let seededCount = 0;
    
    // 1. Seed Groups (level: group)
    const groups = STANDARD_CHART_OF_ACCOUNTS.filter(a => a.level === 'group');
    for (const grp of groups) {
      if (!existingCodes.has(grp.code)) {
        await orm.insert(accounts).values({
          code: grp.code,
          name: grp.name,
          level: grp.level,
          accountType: grp.accountType,
          nature: grp.nature,
          isSystem: 1,
          isActive: 1,
        });
        existingCodes.add(grp.code);
        seededCount++;
      }
    }

    // Reload to get group IDs for parents
    const allAccountsAfterGroups = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
    const codeToIdMap = new Map(allAccountsAfterGroups.map(a => [a.code, a.id]));

    // 2. Seed Generals (level: general)
    const generals = STANDARD_CHART_OF_ACCOUNTS.filter(a => a.level === 'general');
    for (const gen of generals) {
      if (!existingCodes.has(gen.code)) {
        const parentId = gen.parentCode ? codeToIdMap.get(gen.parentCode) : null;
        const [inserted] = await orm.insert(accounts).values({
          code: gen.code,
          name: gen.name,
          level: gen.level,
          parentId: parentId || null,
          accountType: gen.accountType,
          nature: gen.nature,
          isSystem: 1,
          isActive: 1,
        }).returning({ id: accounts.id });
        codeToIdMap.set(gen.code, inserted.id);
        existingCodes.add(gen.code);
        seededCount++;
      }
    }

    // 3. Seed Subsidiaries (level: subsidiary)
    const subsidiaries = STANDARD_CHART_OF_ACCOUNTS.filter(a => a.level === 'subsidiary');
    for (const sub of subsidiaries) {
      if (!existingCodes.has(sub.code)) {
        const parentId = sub.parentCode ? codeToIdMap.get(sub.parentCode) : null;
        await orm.insert(accounts).values({
          code: sub.code,
          name: sub.name,
          level: sub.level,
          parentId: parentId || null,
          accountType: sub.accountType,
          nature: sub.nature,
          isSystem: 1,
          isActive: 1,
        });
        existingCodes.add(sub.code);
        seededCount++;
      }
    }

    // Backfill parentId for existing accounts if missing
    const currentAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
    const currentCodeToIdMap = new Map(currentAccounts.map(a => [a.code, a.id]));
    
    for (const std of STANDARD_CHART_OF_ACCOUNTS) {
      if (std.parentCode) {
        const acc = currentAccounts.find(a => a.code === std.code);
        const expectedParentId = currentCodeToIdMap.get(std.parentCode);
        if (acc && expectedParentId && acc.parentId !== expectedParentId) {
          await orm.update(accounts).set({ parentId: expectedParentId }).where(eq(accounts.id, acc.id));
        }
      }
    }

    // Auto-fix nature
    for (const std of STANDARD_CHART_OF_ACCOUNTS) {
      const acc = currentAccounts.find(a => a.code === std.code);
      if (acc && acc.nature !== std.nature) {
        await orm.update(accounts).set({ nature: std.nature }).where(eq(accounts.id, acc.id));
      }
    }

    // Backfill standard subsidiary accounts (1102, 1103, 1104, etc.)
    const updatedAccounts = await orm.select().from(accounts).where(eq(accounts.isDeleted, 0));
    const updatedCodeToIdMap = new Map(updatedAccounts.map(a => [a.code, a.id]));
    const updatedCodes = new Set(updatedAccounts.map(a => a.code));

    for (const std of STANDARD_CHART_OF_ACCOUNTS) {
      if (!updatedCodes.has(std.code)) {
        const parentId = std.parentCode ? updatedCodeToIdMap.get(std.parentCode) : null;
        await orm.insert(accounts).values({
          code: std.code,
          name: std.name,
          level: std.level,
          parentId: parentId || null,
          accountType: std.accountType,
          nature: std.nature,
          isSystem: 1,
          isActive: 1,
        });
        seededCount++;
      }
    }

    return { seededCount };
  }

  /**
   * Get all active accounts ordered by code
   */
  static async getAllAccounts(tx?: DbExecutor): Promise<Account[]> {
    const executor = tx || orm;
    const raw = await executor.select().from(accounts)
      .where(eq(accounts.isDeleted, 0))
      .orderBy(asc(accounts.code));

    const accountMap = new Map<number, (typeof raw)[number]>(raw.map((a: (typeof raw)[number]) => [a.id, a]));

    return raw.map(a => {
      let parentCode: string | undefined;
      let parentName: string | undefined;
      if (a.parentId && accountMap.has(a.parentId)) {
        const p = accountMap.get(a.parentId)!;
        parentCode = p.code;
        parentName = p.name;
      }
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        level: a.level as AccountLevel,
        parentId: a.parentId,
        parent_id: a.parentId,
        parentCode,
        parentName,
        accountType: a.accountType as AccountType,
        account_type: a.accountType as AccountType,
        nature: (a.nature || 'debit') as AccountNature,
        description: a.description || undefined,
        isSystem: a.isSystem ?? 0,
        is_system: a.isSystem ?? 0,
        isActive: a.isActive ?? 1,
        is_active: a.isActive ?? 1,
        isDeleted: a.isDeleted ?? 0,
        is_deleted: a.isDeleted ?? 0,
        createdAt: a.createdAt || new Date().toISOString()
      };
    });
  }

  /**
   * Get accounts organized in a tree hierarchy
   */
  static async getAccountsTree(): Promise<Account[]> {
    const all = await this.getAllAccounts();
    const { roots, orphanCount, orphanCodes } = this.buildAccountTree(all);

    if (orphanCount > 0) {
      logger.warn('ChartOfAccounts: cyclic/orphaned accounts detected — quarantined as visible roots', {
        orphanCount,
        orphanCodes,
      });
    }

    return roots;
  }

  static buildAccountTree(all: Account[]): {
    roots: (Account & { children?: Account[] })[];
    orphanCount: number;
    orphanCodes: string[];
  } {
    const map = new Map<number, Account & { children?: Account[] }>();
    const roots: (Account & { children?: Account[] })[] = [];

    all.forEach(acc => {
      map.set(acc.id, { ...acc, children: [] });
    });

    all.forEach(acc => {
      const node = map.get(acc.id)!;
      if (acc.parentId && map.has(acc.parentId) && acc.parentId !== acc.id) {
        map.get(acc.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    // v9.0.200 (TD-553، B03-11): حساب‌های یک حلقه بالادست (داده قدیمی) ریشه می‌شوند و پیوند حلقه بریده می‌شود؛ پیش‌تر
    // فرزندانشان به خودشان برمی‌گشتند و JSON درخت با خطای ۵۰۰ «Converting circular structure to JSON» می‌شکست
    const reachable = new Set<number>();
    const visit = (start: Account & { children?: Account[] }) => {
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (reachable.has(node.id)) continue;
        reachable.add(node.id);
        (node.children || []).forEach(child => stack.push(child as Account & { children?: Account[] }));
      }
    };
    roots.forEach(visit);

    const orphans: (Account & { children?: Account[] })[] = [];
    for (const acc of all) {
      if (reachable.has(acc.id)) continue;
      const node = map.get(acc.id)!;
      const parent = acc.parentId ? map.get(acc.parentId) : undefined;
      if (parent) parent.children = (parent.children || []).filter(child => child.id !== node.id);
      orphans.push(node);
      roots.push(node);
      visit(node);
    }
    const orphanCount = orphans.length;
    const orphanCodes = orphans.map(o => o.code);

    return { roots, orphanCount, orphanCodes };
  }

  /**
   * Create a new custom account.
   * v9.0.197 (TD-546، تصمیم ت۴ الف): کد حساب حذف‌شده همیشه ردیف تازه می‌سازد؛ ردیف قدیم (TD-147) دیگر زنده نمی‌شود،
   * چون ردیف‌های سند آن حساب به حساب تازه با نام و نوع دیگر می‌چسبیدند.
   * v9.0.201 (TD-558، B03-16): کد فقط رقم لاتین (۴۲۲ `ACCOUNT_CODE_INVALID`)؛ تکراری، با رقم فارسی هم، ۴۰۹.
   */
  static async createAccount(data: {
    code: string;
    name: string;
    level: AccountLevel;
    parentId?: number | null;
    accountType: AccountType;
    nature: AccountNature;
    description?: string;
  }): Promise<Account> {
    const code = requireAccountCode(data.code);
    const insertedId = await guardAccountCode(code, () => orm.transaction(async (tx) => {
      await assertAccountCodeAvailable(tx, code);
      // v9.0.200 (TD-553، B03-11): بالادست یک سطح بالاتر و حذف‌نشده
      await assertAccountPlacement(tx, { level: data.level, parentId: data.parentId || null });

      const [inserted] = await tx.insert(accounts).values({
        code,
        name: data.name.trim(),
        level: data.level,
        parentId: data.parentId || null,
        accountType: data.accountType,
        nature: data.nature,
        description: data.description?.trim() || null,
        isSystem: 0,
        isActive: 1,
        isDeleted: 0,
      }).returning({ id: accounts.id });
      return inserted.id;
    }));

    const all = await this.getAllAccounts();
    return all.find(a => a.id === insertedId)!;
  }

  /**
   * Update an existing account.
   * v9.0.200 (TD-553، B03-11، تصمیم ت۴ الف): ردیف حساب با `FOR UPDATE` قفل و فقط فیلدهای تغییرکرده سنجیده می‌شوند.
   * حساب سیستمی فقط نام و توضیح می‌پذیرد (۴۰۹ `ACCOUNT_IS_SYSTEM`)؛ حسابی که ردیف سند دارد نوع، ماهیت، سطح و بالادستش
   * عوض نمی‌شود (۴۰۹ `ACCOUNT_HAS_VOUCHER_ROWS`) و نام، توضیح و فعال بودنش عوض می‌شود؛ جای تازه در درخت با
   * `assertAccountPlacement`. پیش‌تر نوع ۵۰۰۱ (درآمد) به دارایی عوض شد و درآمد سال‌های گذشته از صورت سود و زیان افتاد.
   * v9.0.201 (TD-558، B03-16): کد پس از ساخت عوض نمی‌شود (۴۲۲ `ACCOUNT_CODE_IMMUTABLE`؛ پیش‌تر کد تازه بی‌صدا
   * نادیده گرفته می‌شد و پیام «ویرایش شد» می‌آمد). فقط کد قدیمی با رقم فارسی با ذخیره همان حساب لاتین می‌شود.
   */
  static async updateAccount(id: number, data: Partial<{
    code: string;
    name: string;
    level: AccountLevel;
    parentId?: number | null;
    accountType: AccountType;
    nature: AccountNature;
    description?: string;
    isActive?: boolean;
  }>): Promise<Account> {
    const sentCode = data.code === undefined ? undefined : normalizeAccountCode(data.code);
    await guardAccountCode(sentCode ?? '', () => orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
      if (!existing || existing.isDeleted === 1) {
        throw new NotFoundError('حساب مورد نظر یافت نشد.', undefined, 'ACCOUNT_NOT_FOUND');
      }

      const updateData: Partial<typeof accounts.$inferInsert> = {};
      if (sentCode !== undefined) {
        if (sentCode !== normalizeAccountCode(existing.code)) {
          throw new ValidationError(
            `کد حساب پس از ساخت عوض نمی‌شود؛ کد این حساب ${toPersianDigits(existing.code)} است. برای کد تازه، حساب تازه بسازید.`,
            { code: data.code },
            'ACCOUNT_CODE_IMMUTABLE',
          );
        }
        if (sentCode !== existing.code && isValidAccountCode(sentCode)) {
          await assertAccountCodeAvailable(tx, sentCode, id);
          updateData.code = sentCode;
        }
      }
      if (data.name !== undefined && data.name.trim() !== existing.name) updateData.name = data.name.trim();
      if (data.description !== undefined && (data.description?.trim() || null) !== (existing.description || null)) updateData.description = data.description?.trim() || null;
      if (data.level !== undefined && data.level !== existing.level) updateData.level = data.level;
      if (data.parentId !== undefined && (data.parentId || null) !== (existing.parentId || null)) updateData.parentId = data.parentId || null;
      if (data.accountType !== undefined && data.accountType !== existing.accountType) updateData.accountType = data.accountType;
      if (data.nature !== undefined && data.nature !== existing.nature) updateData.nature = data.nature;
      if (data.isActive !== undefined && (data.isActive ? 1 : 0) !== (existing.isActive ?? 1)) updateData.isActive = data.isActive ? 1 : 0;

      const structural = (['level', 'parentId', 'accountType', 'nature'] as const).filter(field => field in updateData);
      if (existing.isSystem === 1 && (structural.length > 0 || 'isActive' in updateData)) {
        throw new ConflictError(
          `حساب «${existing.name}» (کد ${toPersianDigits(existing.code)}) حساب سیستمی است و فقط نام و توضیح آن عوض می‌شود.`,
          { fields: [...structural, ...('isActive' in updateData ? ['isActive'] : [])] },
          'ACCOUNT_IS_SYSTEM',
        );
      }
      if (structural.length > 0) {
        const voucherRows = await countAccountVoucherRows(tx, id);
        if (voucherRows > 0) {
          throw new ConflictError(
            `حساب «${existing.name}» (کد ${toPersianDigits(existing.code)}) در ${toPersianDigits(String(voucherRows))} ردیف سند به کار رفته؛ نوع، ماهیت، سطح و حساب بالادست آن عوض نمی‌شود و فقط نام، توضیح و فعال بودنش تغییر می‌کند.`,
            { fields: structural, voucherRowCount: voucherRows },
            'ACCOUNT_HAS_VOUCHER_ROWS',
          );
        }
        if ('level' in updateData || 'parentId' in updateData) {
          await assertAccountPlacement(tx, {
            id,
            level: updateData.level ?? existing.level,
            parentId: 'parentId' in updateData ? (updateData.parentId ?? null) : (existing.parentId ?? null),
          });
        }
      }

      if (Object.keys(updateData).length > 0) {
        await tx.update(accounts).set(updateData).where(eq(accounts.id, id));
      }
    }));

    const all = await this.getAllAccounts();
    return all.find(a => a.id === id)!;
  }

  /**
   * Restore a soft-deleted account (TD-147)
   * v9.0.201 (TD-558، B03-16): زیر قفل ردیف؛ کدی که حساب فعال دیگری دارد (با رقم فارسی هم) ۴۰۹ `ACCOUNT_CODE_TAKEN`
   * و بالادست حذف‌شده ۴۰۹ است، نه خطای ۵۰۰.
   */
  static async restoreAccount(id: number): Promise<Account> {
    const [current] = await orm.select({ code: accounts.code }).from(accounts).where(eq(accounts.id, id));
    await guardAccountCode(normalizeAccountCode(current?.code), () => orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
      if (!existing) {
        throw new NotFoundError('حساب مورد نظر یافت نشد.', undefined, 'ACCOUNT_NOT_FOUND');
      }
      if (existing.isDeleted === 0) {
        throw new ConflictError('این حساب هم‌اکنون فعال است و حذف نشده است.', undefined, 'ACCOUNT_NOT_DELETED');
      }
      await assertAccountCodeAvailable(tx, normalizeAccountCode(existing.code), id);

      if (existing.parentId) {
        const [parent] = await tx.select().from(accounts).where(eq(accounts.id, existing.parentId));
        if (parent && parent.isDeleted === 1) {
          throw new ConflictError('سرفصل والد این حساب حذف شده است. لطفاً ابتدا حساب والد را احیا نمایید.', undefined, 'ACCOUNT_PARENT_DELETED');
        }
      }

      await tx.update(accounts).set({
        isDeleted: 0,
        isActive: 1,
      }).where(eq(accounts.id, id));
    }));

    const all = await this.getAllAccounts();
    return all.find(a => a.id === id)!;
  }

  /**
   * Delete an account (soft delete).
   * v9.0.197 (TD-546، B03-04، تصمیم ت۴ الف): حسابی که ردیف سند دارد، با هر وضعیت سند، حذف نمی‌شود (۴۰۹
   * `ACCOUNT_HAS_VOUCHER_ROWS`)؛ پیش‌تر حذف آن تراز آزمایشی و ترازنامه را نامتراز می‌کرد و هزینه‌اش از بستن سال می‌افتاد.
   * ردیف حساب با `FOR UPDATE` قفل می‌شود؛ ردیف سند تازه قفل کلید خارجی همین ردیف را می‌خواهد، پس شمارش با ثبت هم‌زمان نمی‌لغزد.
   */
  static async deleteAccount(id: number): Promise<{ success: boolean }> {
    return orm.transaction(async (tx) => {
      const [existing] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
      if (!existing || existing.isDeleted === 1) {
        throw new NotFoundError('حساب مورد نظر یافت نشد.', undefined, 'ACCOUNT_NOT_FOUND');
      }
      if (existing.isSystem === 1) {
        throw new ConflictError('حساب‌های سیستمی و پیش‌فرض قابل حذف نیستند.', undefined, 'ACCOUNT_IS_SYSTEM');
      }

      const children = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.parentId, id), eq(accounts.isDeleted, 0)));
      if (children.length > 0) {
        throw new ConflictError('این حساب دارای زیرمجموعه فعال است و نمی‌توان آن را حذف کرد.', undefined, 'ACCOUNT_HAS_CHILDREN');
      }

      const voucherRows = await countAccountVoucherRows(tx, id);
      if (voucherRows > 0) {
        throw new ConflictError(
          `حساب «${existing.name}» (کد ${existing.code}) در ${toPersianDigits(String(voucherRows))} ردیف سند به کار رفته و حذف نمی‌شود؛ برای کنار گذاشتن آن، حساب را غیرفعال کنید.`,
          { voucherRowCount: voucherRows },
          'ACCOUNT_HAS_VOUCHER_ROWS',
        );
      }

      await tx.update(accounts).set({
        isDeleted: 1,
        isActive: 0,
      }).where(eq(accounts.id, id));

      return { success: true };
    });
  }
}
