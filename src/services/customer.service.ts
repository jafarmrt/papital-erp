import { eq, and, asc, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { customers } from '../db/schema.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../lib/occHelper.js';
import { parsePartyTypeCell } from '../lib/customers/partyTypeCell.js';
import { NotFoundError } from '../errors/customErrors.js';
import { phoneMatchKey } from './woocommerce/phoneMatchKey.js';
import {
  assertCustomerNameAvailable, assertCustomerPhoneAvailable, customerNameKey, guardCustomerName, isCustomerNameUniqueViolation, CUSTOMER_NAME_TAKEN_MESSAGE,
} from './customers/customerIdentity.js';
import { assertCustomerDeletable } from './customers/customerDeleteGuard.js';

export interface ContactPerson {
  id?: string;
  name?: string;
  role?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface BankInfo {
  bankName?: string;
  accountNumber?: string;
  shaba?: string;
  cardNumber?: string;
}

export interface CreateCustomerInput {
  name: string;
  contactName?: string;
  country?: string;
  province?: string;
  city?: string;
  phone?: string;
  address?: string;
  notes?: string;
  partyType?: 'customer' | 'supplier' | 'both';
  supplierCategory?: string;
  bankInfo?: BankInfo;
  contacts?: ContactPerson[];
}

/**
 * v8.0.122 (TD-403): ویرایش همیشه نسخه رکوردی را که از آن ساخته شده همراه دارد (version یا expectedVersion).
 * v10.0.33 (TD-975): هر فیلدی که در بدنه نیست مقدار کنونی‌اش را نگه می‌دارد.
 */
export type UpdateCustomerInput = Partial<CreateCustomerInput> & ({ version: number; expectedVersion?: number } | { version?: number; expectedVersion: number });

export interface BulkImportRowInput {
  id?: number | string;
  /** نسخه رکورد در فایل خروجی (ستون «نسخه»)؛ برای ردیف دارای شناسه الزامی است (TD-403) */
  version?: number | string;
  name: string;
  contactName?: string;
  phone?: string;
  partyType?: string;
  supplierCategory?: string;
  country?: string;
  province?: string;
  city?: string;
  address?: string;
  notes?: string;
  bankName?: string;
  accountNumber?: string;
  shaba?: string;
  cardNumber?: string;
  bankInfo?: BankInfo;
}

export interface BulkImportResult {
  success: boolean;
  createdCount: number;
  updatedCount: number;
  totalProcessed: number;
  errors: Array<{ row: number; name?: string; message: string }>;
  createdRecords: Array<{ id: number; name: string; partyType: string; phone?: string }>;
  updatedRecords: Array<{ id: number; name: string; partyType: string; updatedData: Partial<typeof customers.$inferInsert> }>;
}

export class CustomerService {
  /**
   * Retrieves a customer by ID with soft-delete filter
   */
  static async getById(id: number, executor: DbExecutor = orm): Promise<typeof customers.$inferSelect | null> {
    const [row] = await executor
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.isDeleted, 0)));
    return row || null;
  }

  /**
   * Creates a new customer/supplier with uniqueness validation
   */
  static async createCustomer(
    data: CreateCustomerInput,
    executor: DbExecutor = orm
  ): Promise<typeof customers.$inferSelect> {
    const name = data.name.trim();
    let contactName = data.contactName?.trim() || '';
    let phone = data.phone?.trim() || '';
    const partyType = data.partyType || 'customer';
    const supplierCategory = data.supplierCategory?.trim() || '';
    const bankInfo = data.bankInfo || {};
    const country = data.country?.trim() || 'ایران';
    const province = data.province?.trim() || '';
    const city = data.city?.trim() || '';
    const address = data.address?.trim() || '';
    const notes = data.notes?.trim() || '';
    const contacts = data.contacts || [];

    // Auto-derive contactName and phone from contacts if available
    const activeContacts = (contacts as ContactPerson[]).filter((c) => c.name?.trim() || c.phone?.trim());
    if (activeContacts.length > 0) {
      const primary = activeContacts.find((c) => c.isPrimary) || activeContacts[0];
      if (!contactName) {
        contactName = primary.role ? `${primary.name} (${primary.role})` : (primary.name || '');
      }
      if (!phone) {
        const allPhones = activeContacts.map((c) => c.phone).filter(Boolean);
        phone = Array.from(new Set(allPhones)).join(', ');
      }
    }

    // v9.0.8 (TD-420): نام با کلید ایندکس یکتای uq_customers_name_active؛ نقض ایندکس در رقابت همان پیام را می‌دهد
    if (name) await assertCustomerNameAvailable(name, executor);

    // v9.0.7 (TD-419): تلفن با کلید تطبیق (همان شماره با نگارش دیگر تکراری است)
    await assertCustomerPhoneAvailable(phone, executor);

    const createdAt = new Date().toISOString();
    const [created] = await guardCustomerName(() => executor
      .insert(customers)
      .values({
        name,
        contactName,
        country,
        province,
        phone,
        city,
        address,
        notes,
        partyType,
        supplierCategory,
        bankInfo,
        contacts: activeContacts,
        createdAt,
        isDeleted: 0,
        version: 1
      })
      .returning());

    return created;
  }

  /**
   * Updates an existing customer with OCC verification and row-level safety
   */
  static async updateCustomer(
    id: number,
    data: UpdateCustomerInput,
    executor: DbExecutor = orm
  ): Promise<{ previous: typeof customers.$inferSelect; current: typeof customers.$inferSelect }> {
    const customerId = Number(id);
    const [prevCust] = await executor
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.isDeleted, 0)));

    if (!prevCust) {
      throw new NotFoundError('طرف حساب مورد نظر یافت نشد.');
    }

    // v8.0.122 (TD-403): قفل خوش‌بینانه همیشه اجرا می‌شود؛ پیش‌تر نسخه در مسیر حذف می‌شد و این بررسی هرگز اجرا نمی‌شد
    const expectedVersion = Number(data.expectedVersion ?? data.version);
    checkOccVersion(prevCust, { entityType: 'Customer', entityId: customerId, expectedVersion });

    // v10.0.33 (TD-975): فیلد نفرستاده مقدار کنونی را نگه می‌دارد (پیش‌تر پیش‌فرض‌های Zod آن را خالی می‌کردند)
    const keep = (sent: string | undefined, current: string | null): string => (sent === undefined ? (current ?? '') : sent.trim());
    const name = data.name === undefined ? prevCust.name : data.name.trim();
    let contactName = keep(data.contactName, prevCust.contactName);
    let phone = keep(data.phone, prevCust.phone);
    const partyType = data.partyType ?? ((prevCust.partyType as CreateCustomerInput['partyType']) || 'customer');
    const supplierCategory = keep(data.supplierCategory, prevCust.supplierCategory);
    // اطلاعات بانکی فرستاده‌شده روی مقدار کنونی ادغام می‌شود؛ کلید نفرستاده همان می‌ماند
    const bankInfo = data.bankInfo === undefined
      ? (prevCust.bankInfo ?? {})
      : { ...((prevCust.bankInfo as BankInfo | null) ?? {}), ...data.bankInfo };
    const country = keep(data.country, prevCust.country) || 'ایران';
    const province = keep(data.province, prevCust.province);
    const city = keep(data.city, prevCust.city);
    const address = keep(data.address, prevCust.address);
    const notes = keep(data.notes, prevCust.notes);
    const contacts = data.contacts ?? ((prevCust.contacts as ContactPerson[] | null) ?? []);

    const activeContacts = (contacts as ContactPerson[]).filter((c) => c.name?.trim() || c.phone?.trim());
    if (activeContacts.length > 0) {
      const primary = activeContacts.find((c) => c.isPrimary) || activeContacts[0];
      if (!contactName) {
        contactName = primary.role ? `${primary.name} (${primary.role})` : (primary.name || '');
      }
      if (!phone) {
        const allPhones = activeContacts.map((c) => c.phone).filter(Boolean);
        phone = Array.from(new Set(allPhones)).join(', ');
      }
    }

    // v9.0.8 (TD-420): فقط نام تازه سنجیده می‌شود (هم‌نام‌های قدیمی ویرایش را نمی‌بندند)
    if (name && customerNameKey(name) !== customerNameKey(prevCust.name)) await assertCustomerNameAvailable(name, executor, customerId);

    // v9.0.7 (TD-419): فقط شماره تازه سنجیده می‌شود؛ نگه داشتن شماره قبلی (با هر نگارشی) ویرایش را رد نمی‌کند
    if (phoneMatchKey(phone) !== phoneMatchKey(prevCust.phone)) await assertCustomerPhoneAvailable(phone, executor, customerId);

    const updatedData: Partial<typeof customers.$inferInsert> = {
      name,
      contactName,
      country,
      province,
      phone,
      city,
      address,
      notes,
      partyType,
      supplierCategory,
      bankInfo,
      contacts: activeContacts,
      version: nextVersion(prevCust.version)
    };

    // ویرایش هم‌زمانی که میان خواندن و نوشتن نسخه را جلو برده باشد ردیفی را تغییر نمی‌دهد و تداخل گزارش می‌شود
    const [current] = await guardCustomerName(() => executor
      .update(customers)
      .set(updatedData)
      .where(and(eq(customers.id, customerId), eq(customers.version, prevCust.version), eq(customers.isDeleted, 0)))
      .returning());
    if (!current) {
      throw new OptimisticLockError({ entityType: 'Customer', entityId: customerId, expectedVersion });
    }

    return { previous: prevCust, current };
  }

  /**
   * Soft-deletes a customer (isDeleted = 1)
   */
  static async deleteCustomer(
    id: number,
    executor: DbExecutor = orm
  ): Promise<typeof customers.$inferSelect> {
    const customerId = Number(id);
    // v9.0.10 (TD-431): زیر قفل ردیف طرف حساب؛ مانده، سند پیش‌نویس یا پیش‌فاکتور، پرونده فعال، پروژه یا چک باز حذف را رد می‌کند
    const remove = async (tx: DbExecutor) => {
      const [delCust] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.isDeleted, 0)))
        .for('update');

      if (!delCust) {
        throw new NotFoundError('مشتری یافت نشد.');
      }
      await assertCustomerDeletable(delCust, tx);

      await tx
        .update(customers)
        .set({ isDeleted: 1 })
        .where(sql`${customers.id} = ${customerId}`);

      return delCust;
    };
    return executor === orm ? orm.transaction(remove) : remove(executor);
  }

  /**
   * Bulk imports or updates counterparties from Excel dataset
   */
  static async bulkImport(
    rows: BulkImportRowInput[],
    updateIfExists: boolean = true,
    executor: DbExecutor = orm
  ): Promise<BulkImportResult> {
    let createdCount = 0;
    let updatedCount = 0;
    const errors: Array<{ row: number; name?: string; message: string }> = [];
    const createdRecords: Array<{ id: number; name: string; partyType: string; phone?: string }> = [];
    const updatedRecords: Array<{ id: number; name: string; partyType: string; updatedData: Partial<typeof customers.$inferInsert> }> = [];

    const existingList = await executor.select().from(customers).where(eq(customers.isDeleted, 0)).orderBy(asc(customers.id));

    const idMap = new Map<number, typeof customers.$inferSelect>();
    const nameMap = new Map<string, typeof customers.$inferSelect>();
    const phoneMap = new Map<string, typeof customers.$inferSelect>();

    existingList.forEach((c) => {
      idMap.set(c.id, c);
      if (c.name && c.name.trim()) {
        nameMap.set(c.name.trim().toLowerCase(), c);
      }
      // v9.0.7 (TD-419): نقشه تلفن با کلید تطبیق؛ شماره‌ای که اکسل صفر اولش را انداخته هم همان شماره است
      if (phoneMatchKey(c.phone) && !phoneMap.has(phoneMatchKey(c.phone))) {
        phoneMap.set(phoneMatchKey(c.phone), c);
      }
    });

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      const rowIndex = i + 1;

      try {
        const name = String(item.name || '').trim();
        if (!name) {
          errors.push({ row: rowIndex, message: 'نام طرف حساب مشخص نشده است.' });
          continue;
        }

        const id = item.id ? Number(item.id) : undefined;
        const contactName = String(item.contactName || '').trim();
        const phone = String(item.phone || '').trim();
        // v9.0.9 (TD-421): نوع خالی undefined است؛ رکورد موجود نوعش را نگه می‌دارد و رکورد تازه «مشتری» می‌شود
        const cellType = parsePartyTypeCell(item.partyType);

        const supplierCategory = String(item.supplierCategory || '').trim();
        const country = String(item.country || 'ایران').trim();
        const province = String(item.province || '').trim();
        const city = String(item.city || '').trim();
        const address = String(item.address || '').trim();
        const notes = String(item.notes || '').trim();

        const bankInfo = {
          bankName: String(item.bankName || item.bankInfo?.bankName || '').trim(),
          accountNumber: String(item.accountNumber || item.bankInfo?.accountNumber || '').trim(),
          shaba: String(item.shaba || item.bankInfo?.shaba || '').trim(),
          cardNumber: String(item.cardNumber || item.bankInfo?.cardNumber || '').trim(),
        };

        // Match existing counterparty
        let matchedCust: typeof customers.$inferSelect | undefined;
        if (id && idMap.has(id)) {
          matchedCust = idMap.get(id);
        } else if (nameMap.has(name.toLowerCase())) {
          matchedCust = nameMap.get(name.toLowerCase());
        } else if (phoneMatchKey(phone) && phoneMap.has(phoneMatchKey(phone))) {
          matchedCust = phoneMap.get(phoneMatchKey(phone));
        }

        if (matchedCust) {
          // v8.0.122 (TD-403): ردیفِ دارای شناسه فقط با نسخه‌ای که از آن خروجی گرفته شده رکورد را به‌روز می‌کند؛ پیش‌تر
          // فایل قدیمی ویرایش‌های بعدی دیگران را بی‌صدا بازنویسی می‌کرد. ردیف بی شناسه که با نام یا تلفن جور شده،
          // اگر نسخه داشته باشد همان سنجش را دارد.
          const fileVersion = String(item.version ?? '').trim() === '' ? undefined : Number(item.version);
          const matchedById = id !== undefined && matchedCust.id === id;
          if (updateIfExists && matchedById && fileVersion === undefined) {
            errors.push({ row: rowIndex, name, message: `ردیف شناسه ${matchedCust.id} ستون «نسخه» ندارد؛ از فهرست خروجی تازه بگیرید و دوباره بارگذاری کنید.` });
            continue;
          }
          if (updateIfExists && fileVersion !== undefined && fileVersion !== matchedCust.version) {
            errors.push({ row: rowIndex, name, message: `طرف حساب "${matchedCust.name}" پس از گرفتن این فایل ویرایش شده است (نسخه فایل ${String(item.version)}، نسخه کنونی ${matchedCust.version})؛ از فهرست خروجی تازه بگیرید.` });
            continue;
          }
          if (updateIfExists) {
            const updatedData: Partial<typeof customers.$inferInsert> = {
              name,
              contactName: contactName || matchedCust.contactName,
              country: country || matchedCust.country,
              province: province || matchedCust.province,
              city: city || matchedCust.city,
              phone: phone || matchedCust.phone,
              address: address || matchedCust.address,
              notes: notes || matchedCust.notes,
              partyType: cellType ?? matchedCust.partyType,
              supplierCategory: supplierCategory || matchedCust.supplierCategory,
              bankInfo: {
                ...((matchedCust.bankInfo as Record<string, unknown>) || {}),
                ...(bankInfo.bankName ? { bankName: bankInfo.bankName } : {}),
                ...(bankInfo.accountNumber ? { accountNumber: bankInfo.accountNumber } : {}),
                ...(bankInfo.shaba ? { shaba: bankInfo.shaba } : {}),
                ...(bankInfo.cardNumber ? { cardNumber: bankInfo.cardNumber } : {}),
              },
              version: nextVersion(matchedCust.version)
            };

            const [saved] = await executor.update(customers).set(updatedData)
              .where(and(eq(customers.id, matchedCust.id), eq(customers.version, matchedCust.version), eq(customers.isDeleted, 0))).returning();
            if (!saved) {
              errors.push({ row: rowIndex, name, message: `طرف حساب "${matchedCust.name}" هم‌زمان ویرایش شد؛ این ردیف اعمال نشد.` });
              continue;
            }
            idMap.set(saved.id, saved);
            nameMap.set(name.toLowerCase(), saved);
            if (phoneMatchKey(saved.phone)) phoneMap.set(phoneMatchKey(saved.phone), saved);

            updatedRecords.push({ id: matchedCust.id, name, partyType: saved.partyType ?? 'customer', updatedData });
            updatedCount++;
          } else {
            errors.push({
              row: rowIndex,
              name,
              message: `طرف حساب "${name}" از قبل در سیستم وجود دارد و گزینه به‌روزرسانی غیرفعال بود.`
            });
          }
        } else {
          const partyType = cellType ?? 'customer';
          const [newCust] = await executor
            .insert(customers)
            .values({
              name,
              contactName,
              country,
              province,
              city,
              phone,
              address,
              notes,
              partyType,
              supplierCategory,
              bankInfo,
              contacts: contactName || phone ? [{ id: '1', name: contactName, role: 'رابط اصلی', phone, isPrimary: true }] : [],
              createdAt: new Date().toISOString(),
              isDeleted: 0,
              version: 1
            })
            .returning();

          idMap.set(newCust.id, newCust);
          nameMap.set(name.toLowerCase(), newCust);
          if (phoneMatchKey(phone)) phoneMap.set(phoneMatchKey(phone), newCust);

          createdRecords.push({ id: newCust.id, name, partyType, phone });
          createdCount++;
        }
      } catch (err: unknown) {
        const errorMsg = isCustomerNameUniqueViolation(err) ? CUSTOMER_NAME_TAKEN_MESSAGE : (err instanceof Error ? err.message : 'خطای ناشناخته در پردازش سطر');
        errors.push({
          row: rowIndex,
          name: rows[i]?.name,
          message: errorMsg
        });
      }
    }

    return {
      success: true,
      createdCount,
      updatedCount,
      totalProcessed: rows.length,
      errors,
      createdRecords,
      updatedRecords
    };
  }
}
