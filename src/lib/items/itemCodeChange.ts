/**
 * v10.1.7 (D-15, TD-1264): the change-code operation's limits and messages, shared by the route schema, the server and the
 * «تغییر کد» window.
 */
export const ITEM_CODE_CHANGE_REASON_MAX = 500;

/** The window's own check before sending; the server repeats it (and the code format, uniqueness and version) */
export function itemCodeChangeError(currentCode: string, newCode: string, reason: string): string | null {
  const code = newCode.trim();
  if (!code) return 'کد تازه را بنویسید.';
  if (code === currentCode.trim()) return 'کد تازه با کد فعلی کالا یکی است.';
  if (!reason.trim()) return 'دلیل تغییر کد را بنویسید.';
  if (reason.trim().length > ITEM_CODE_CHANGE_REASON_MAX) return 'دلیل تغییر کد بیش از اندازه بلند است.';
  return null;
}

/** Note of a WooCommerce order whose lines found their items by an earlier code, or '' */
export function oldCodeOrderNote(oldCodes: readonly string[]): string {
  if (oldCodes.length === 0) return '';
  const list = oldCodes.map(code => `«${code}»`).join('، ');
  return `کالا با کد قدیم ${list} پیدا شد؛ کد این کالا را در سایت هم به کد تازه تغییر دهید.`;
}
