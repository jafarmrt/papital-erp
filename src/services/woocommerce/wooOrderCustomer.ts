import type { DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { formatPersianPhone } from '../../utils/cardValidation.js';
import { findActiveCustomerByName, findActiveCustomerByPhone, isCustomerNameUniqueViolation } from '../customers/customerIdentity.js';
import { phoneMatchKey } from './phoneMatchKey.js';

/**
 * v9.0.332 (TD-703، B15-01، تصمیم مالک محصول ت۱ الف): طرف حساب فاکتور سفارش ووکامرس.
 * - تلفن خریدار با کلید تطبیق (TD-296) طرف حساب موجود را می‌یابد؛ بی تلفن، نام با کلید یکتایی `lower(btrim(name))` (TD-420).
 * - فاکتور نام **ذخیره‌شده** طرف حساب را می‌گیرد، پس سند فروش (تطبیق دقیق نام) همان طرف حساب را می‌یابد؛ پیش‌تر «sara ahmadi»
 *   برای «Sara Ahmadi» ردیف دریافتنی بی طرف حساب گرفت.
 * - خریدار تازه‌ای که نامش نام طرف حساب دیگری است (تلفن متفاوت، یا طرف حساب موجود بی تلفن) طرف حساب تازه با نام متمایز
 *   «نام (تلفن)» می‌گیرد و این در گزارش سفارش می‌آید؛ سفارش‌های بعدی او با کلید تلفن به همین طرف حساب می‌رسند. پیش‌تر ساخت
 *   روی ایندکس یکتای نام بی‌صدا شکست می‌خورد و فروش به حساب طرف حساب هم‌نام می‌نشست.
 * - شکست ساخت دیگر بلعیده نمی‌شود: نام متمایزِ گرفته‌شده سفارش را با پیام روشن رد می‌کند (قابل تلاش دوباره با همگام‌سازی دستی)،
 *   و نقض ایندکس نام در رقابت دو سفارش هم‌زمان یک بار تطبیق را دوباره اجرا می‌کند.
 */

export interface WooOrderBuyer {
  buyerName: string;
  buyerPhone: string;
  buyerCity: string;
  buyerAddress: string;
}

export interface WooOrderCustomer {
  /** نام ذخیره‌شده طرف حساب؛ همان نامی که فاکتور می‌گیرد */
  name: string;
  /** یادداشت فارسی برای گزارش سفارش (فقط وقتی برای خریدار هم‌نام طرف حساب تازه ساخته شد) */
  note: string;
}

/** نام متمایز خریدار هم‌نام: «نام (تلفن با ارقام فارسی)» */
export function namesakeCustomerName(name: string, phone: string): string {
  return `${name.trim()} (${formatPersianPhone(phone) || phone.trim()})`;
}

async function findOrderCustomer(tx: DbExecutor, buyer: WooOrderBuyer): Promise<WooOrderCustomer | null> {
  const row = phoneMatchKey(buyer.buyerPhone)
    ? await findActiveCustomerByPhone(buyer.buyerPhone, tx)
    : await findActiveCustomerByName(buyer.buyerName, tx);
  return row ? { name: row.name, note: '' } : null;
}

async function newCustomerTarget(tx: DbExecutor, wcOrderId: string, buyer: WooOrderBuyer): Promise<WooOrderCustomer> {
  const namesake = phoneMatchKey(buyer.buyerPhone) ? await findActiveCustomerByName(buyer.buyerName, tx) : undefined;
  if (!namesake) return { name: buyer.buyerName.trim(), note: '' };
  const name = namesakeCustomerName(buyer.buyerName, buyer.buyerPhone);
  const taken = await findActiveCustomerByName(name, tx);
  if (taken) {
    throw new ValidationError(
      `خریدار سفارش ووکامرس #${wcOrderId} هم‌نام طرف حساب «${namesake.name}» با تلفن دیگری است و نام متمایز «${name}» هم برای طرف حساب دیگری ثبت شده است. طرف حساب درست را مشخص کنید و سفارش را با «همگام‌سازی دستی» دوباره دریافت کنید.`,
      undefined,
      'WOO_NAMESAKE_CUSTOMER_TAKEN'
    );
  }
  return {
    name,
    note: `خریدار هم‌نام طرف حساب «${namesake.name}» با تلفن دیگری است؛ طرف حساب تازه «${name}» ساخته شد و فاکتور به حساب او رفت.`,
  };
}

/** طرف حساب سفارش را می‌یابد یا (درون savepoint، با ردیف ممیزی) می‌سازد */
export async function resolveWooOrderCustomer(
  tx: DbExecutor,
  wcOrderId: string,
  buyer: WooOrderBuyer,
  actor: string
): Promise<WooOrderCustomer> {
  for (let attempt = 0; ; attempt++) {
    const found = await findOrderCustomer(tx, buyer);
    if (found) return found;
    const target = await newCustomerTarget(tx, wcOrderId, buyer);
    try {
      await tx.transaction(async (sp) => {
        const [created] = await sp.insert(customers).values({
          name: target.name,
          phone: buyer.buyerPhone,
          city: buyer.buyerCity,
          address: buyer.buyerAddress,
          notes: 'مشتری ثبت‌شده خودکار از فروشگاه ووکامرس',
        }).returning({ id: customers.id });
        await logActivity({
          tx: sp,
          username: actor,
          action: 'CREATE',
          entity: 'طرف حساب',
          entityId: created.id,
          description: `ثبت خودکار طرف حساب «${target.name}» از سفارش ووکامرس #${wcOrderId}`,
          details: { after: { id: created.id, name: target.name, phone: buyer.buyerPhone, city: buyer.buyerCity }, namesake: target.note || undefined },
        });
      });
      return target;
    } catch (err) {
      // سفارش هم‌زمان دیگری همین طرف حساب را ساخت؛ تطبیق یک بار دیگر، حالا با ردیف commitشده او
      if (attempt === 0 && isCustomerNameUniqueViolation(err)) continue;
      throw err;
    }
  }
}
