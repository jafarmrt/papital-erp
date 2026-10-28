/**
 * v11 history import: an amount or quantity of an Excel row, as plain decimal text with at most four decimals and above
 * zero, or null. Exponents («1e3») and float noise («0.30000000000000004») are refused, not read.
 */
export function historyImportAmount(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  if (/^0+$/.test(whole) && !fraction) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}
