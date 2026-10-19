/**
 * The rial units of a WooCommerce shop and their factor to rial, shared by the order sync (an order's amounts become rial,
 * TD-022 / TD-292) and the price push of 10.2 package 6 part C (a rial price becomes the shop's unit). IRT / TOMAN are ten
 * rials; «هزار ریال» (IRHR) and «هزار تومان» (IRHT) of the Persian WooCommerce plugin are 1,000 and 10,000.
 */
const RIAL_UNIT_MULTIPLIERS: ReadonlyMap<string, number> = new Map([
  ['IRR', 1], ['ریال', 1],
  ['IRT', 10], ['TOMAN', 10], ['تومان', 10],
  ['IRHR', 1_000], ['هزار ریال', 1_000],
  ['IRHT', 10_000], ['هزار تومان', 10_000],
]);

/** Rials in one unit of this shop currency, or undefined for a currency that is not a rial unit (USD, EUR …) */
export function rialUnitMultiplier(code: unknown): number | undefined {
  return RIAL_UNIT_MULTIPLIERS.get(String(code ?? '').trim().toUpperCase());
}
