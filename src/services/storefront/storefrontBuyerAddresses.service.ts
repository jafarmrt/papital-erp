import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerAddresses } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { BUYER_ADDRESSES_MAX } from '../../lib/storefront/storefrontOrderRules.js';
import type { BuyerAddress, BuyerAddressBook } from '../../lib/storefront/storefrontOrderContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { requireAccount } from './storefrontBuyerAuth.service.js';

/**
 * v12 phase 8c (start plan §5): the address book of a buyer account. An address is kept from the checkout, inside the
 * order's own transaction (`saveAddress` on the order), and «حساب من» lists them, makes one the default and removes one
 * (a soft delete). An account reads and changes only its own addresses; another's id is the same 404 as a missing one.
 * One account's book changes one at a time (an advisory lock), so the cap and the single default hold under concurrent
 * requests; the partial unique index on the default is the last guard. Every change writes its audit row; an address is
 * a buyer's own data, so the row names the account and the address id only, never the address itself.
 */
type AddressRow = typeof storefrontBuyerAddresses.$inferSelect;

const notFound = () => new NotFoundError('این نشانی پیدا نشد.', undefined, 'STOREFRONT_ADDRESS_NOT_FOUND');

async function lockBook(tx: DbExecutor, accountId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`storefront-addresses:${accountId}`}))`);
}

const live = (accountId: number) => and(eq(storefrontBuyerAddresses.accountId, accountId), eq(storefrontBuyerAddresses.isDeleted, 0));

const view = (r: AddressRow): BuyerAddress => ({
  id: r.id, recipientName: r.recipientName, recipientPhone: r.recipientPhone, province: r.province, city: r.city, address: r.address,
  postalCode: r.postalCode, isDefault: r.isDefault === 1,
});

async function bookOf(executor: DbExecutor, accountId: number): Promise<BuyerAddressBook> {
  const rows = await executor.select().from(storefrontBuyerAddresses).where(live(accountId))
    .orderBy(desc(storefrontBuyerAddresses.isDefault), desc(storefrontBuyerAddresses.updatedAt), desc(storefrontBuyerAddresses.id));
  return { data: rows.map(view), max: BUYER_ADDRESSES_MAX };
}

async function makeDefault(tx: DbExecutor, accountId: number, id: number): Promise<void> {
  const now = systemNowUtcIso();
  await tx.update(storefrontBuyerAddresses).set({ isDefault: 0, updatedAt: now, version: sql`${storefrontBuyerAddresses.version} + 1` })
    .where(and(live(accountId), eq(storefrontBuyerAddresses.isDefault, 1), ne(storefrontBuyerAddresses.id, id)));
  await tx.update(storefrontBuyerAddresses).set({ isDefault: 1, updatedAt: now, version: sql`${storefrontBuyerAddresses.version} + 1` })
    .where(and(live(accountId), eq(storefrontBuyerAddresses.id, id)));
}

/**
 * Keeps an order's recipient and address as the account's default, in the order's transaction: the same address
 * already in the book becomes the default; a new one is added as the default while the book has room. A full book keeps
 * its addresses (the checkout offers the box only while there is room), so the order never fails for its address book.
 */
export async function keepOrderAddress(tx: DbExecutor, accountId: number, order: {
  recipientName: string; recipientPhone?: string; province: string; city: string; address: string; postalCode: string;
}): Promise<void> {
  await lockBook(tx, accountId);
  const fields = {
    recipientName: order.recipientName, recipientPhone: order.recipientPhone ?? '', province: order.province, city: order.city,
    address: order.address, postalCode: order.postalCode,
  };
  const rows = await tx.select().from(storefrontBuyerAddresses).where(live(accountId));
  const same = rows.find(r => r.recipientName === fields.recipientName && r.recipientPhone === fields.recipientPhone && r.province === fields.province
    && r.city === fields.city && r.address === fields.address && r.postalCode === fields.postalCode);
  if (same) {
    if (same.isDefault === 1) return;
    await makeDefault(tx, accountId, same.id);
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'نشانی خریدار سایت', entityId: same.id,
      description: 'نشانی سفارش تازه، نشانی پیش‌فرض حساب خریدار سایت شد', details: { before: { isDefault: false }, after: { accountId, isDefault: true } },
    });
    return;
  }
  if (rows.length >= BUYER_ADDRESSES_MAX) return;
  const [created] = await tx.insert(storefrontBuyerAddresses).values({ accountId, ...fields }).returning({ id: storefrontBuyerAddresses.id });
  await makeDefault(tx, accountId, created.id);
  await logActivity({
    tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'نشانی خریدار سایت', entityId: created.id,
    description: 'نشانی تازه در دفترچهٔ نشانی حساب خریدار سایت ماند', details: { after: { accountId, addressId: created.id, isDefault: true } },
  });
}

/** `GET /account/addresses` */
export async function myAddresses(rawToken: unknown): Promise<BuyerAddressBook> {
  const account = await requireAccount(rawToken);
  return bookOf(orm, account.id);
}

/** `POST /account/addresses/:id/default` */
export async function setDefaultAddress(rawToken: unknown, id: number): Promise<BuyerAddressBook> {
  const account = await requireAccount(rawToken);
  return orm.transaction(async (tx) => {
    await lockBook(tx, account.id);
    const [row] = await tx.select().from(storefrontBuyerAddresses).where(and(live(account.id), eq(storefrontBuyerAddresses.id, id))).for('update');
    if (!row) throw notFound();
    if (row.isDefault !== 1) {
      await makeDefault(tx, account.id, id);
      await logActivity({
        tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'نشانی خریدار سایت', entityId: id,
        description: 'نشانی پیش‌فرض حساب خریدار سایت عوض شد', details: { before: { isDefault: false }, after: { accountId: account.id, isDefault: true } },
      });
    }
    return bookOf(tx, account.id);
  });
}

/** `DELETE /account/addresses/:id`: a soft delete; when it was the default, the newest other address becomes the default */
export async function removeAddress(rawToken: unknown, id: number): Promise<BuyerAddressBook> {
  const account = await requireAccount(rawToken);
  return orm.transaction(async (tx) => {
    await lockBook(tx, account.id);
    const [row] = await tx.select().from(storefrontBuyerAddresses).where(and(live(account.id), eq(storefrontBuyerAddresses.id, id))).for('update');
    if (!row) throw notFound();
    await tx.update(storefrontBuyerAddresses).set({ isDeleted: 1, isDefault: 0, updatedAt: systemNowUtcIso(), version: sql`${storefrontBuyerAddresses.version} + 1` })
      .where(eq(storefrontBuyerAddresses.id, id));
    if (row.isDefault === 1) {
      const [next] = await tx.select({ id: storefrontBuyerAddresses.id }).from(storefrontBuyerAddresses).where(live(account.id))
        .orderBy(desc(storefrontBuyerAddresses.updatedAt), desc(storefrontBuyerAddresses.id)).limit(1);
      if (next) await makeDefault(tx, account.id, next.id);
    }
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'DELETE', entity: 'نشانی خریدار سایت', entityId: id,
      description: 'نشانی از دفترچهٔ نشانی حساب خریدار سایت برداشته شد', details: { before: { accountId: account.id, isDefault: row.isDefault === 1 }, after: { isDeleted: true } },
    });
    return bookOf(tx, account.id);
  });
}

