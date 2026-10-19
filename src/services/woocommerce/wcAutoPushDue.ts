/**
 * 10.2 package 6 (D-04 part B, review M-3): links the automatic push compares on its next run whatever their sellable stock
 * did. An order webhook marks its order's products (after the order's own transaction, never inside it), so an order the
 * program does not invoice yet (on hold) or a refund or cancellation in the shop brings the shop back in line within a
 * minute instead of waiting for the hourly pass. Held in memory, like the settled stock of each link (one server process,
 * AGENTS §22); a restart loses nothing that the hourly pass, which runs first after a start, does not compare again.
 */
const dueOrderKeys = new Set<string>();
const dueLinkIds = new Set<number>();
/** past this many marked keys the next run compares every link instead (a burst of orders never grows the set unbounded) */
const MAX_DUE_KEYS = 5000;
let everyLinkDue = false;

const orderKey = (productId: number, variationId: number) => `${productId}:${variationId}`;

/** The products of one order's lines (WooCommerce `line_items`), compared on the next automatic run */
export function markOrderLinesDue(lines: unknown): void {
  if (!Array.isArray(lines)) return;
  for (const raw of lines) {
    const line = raw as { product_id?: unknown; variation_id?: unknown } | null;
    const productId = Number(line?.product_id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    const variationId = Number(line?.variation_id);
    dueOrderKeys.add(orderKey(productId, Number.isInteger(variationId) && variationId > 0 ? variationId : 0));
  }
  if (dueOrderKeys.size > MAX_DUE_KEYS) {
    dueOrderKeys.clear();
    everyLinkDue = true;
  }
}

/** Links one run had to leave for the next (the `WC_AUTO_PUSH_MAX_PRODUCTS` cap) */
export function markLinksDue(linkIds: number[]): void {
  for (const id of linkIds) dueLinkIds.add(id);
}

export interface DueMarks { orderKeys: Set<string>; productIds: Set<number>; linkIds: Set<number>; everyLink: boolean }

/** What was marked since the last run, emptied; a run that fails puts it back with `restoreDueMarks` */
export function takeDueMarks(): DueMarks {
  const productIds = new Set([...dueOrderKeys].map(k => Number(k.split(':')[0])));
  const marks = { orderKeys: new Set(dueOrderKeys), productIds, linkIds: new Set(dueLinkIds), everyLink: everyLinkDue };
  dueOrderKeys.clear();
  dueLinkIds.clear();
  everyLinkDue = false;
  return marks;
}

export function restoreDueMarks(marks: DueMarks): void {
  for (const key of marks.orderKeys) dueOrderKeys.add(key);
  for (const id of marks.linkIds) dueLinkIds.add(id);
  everyLinkDue = everyLinkDue || marks.everyLink;
}

/** Whether the marks name this link: its own id, its product and variation, or (a variation line without its own link)
 * its parent product */
export function isMarkedDue(marks: DueMarks, link: { id: number; wcProductId: number; wcVariationId: number }): boolean {
  return marks.everyLink || marks.linkIds.has(link.id) || marks.orderKeys.has(orderKey(link.wcProductId, link.wcVariationId))
    || (link.wcVariationId === 0 && marks.productIds.has(link.wcProductId));
}

/** test hook: forget every mark, as after a restart */
export function forgetDueMarks(): void {
  takeDueMarks();
}
