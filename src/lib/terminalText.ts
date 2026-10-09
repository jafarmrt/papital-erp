/** Persian or Arabic letters: text a terminal shows badly (owner rule t9) */
export const PERSIAN_TEXT = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** A run of Persian text with the spaces, digits and punctuation inside it; it stops at the next Latin letter */
const PERSIAN_RUN = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF«»][\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF«»\u200c\s\d.,:;!?()\-]*/g;
export const PERSIAN_TERMINAL_MARKER = '[Persian text in the log file]';

/**
 * v9.0.450 (TD-625, B01-45, owner rule t9): a log line printed on the terminal carries no Persian. A message built from
 * a Persian value (a business error, a skipped item's reason) prints each Persian run as a short English marker; the
 * JSON log files keep the full message, since their format serializes the entry itself, not this line.
 */
export function terminalLine(line: string): string {
  if (!PERSIAN_TEXT.test(line)) return line;
  return line.replace(PERSIAN_RUN, run => PERSIAN_TERMINAL_MARKER + (/\s$/.test(run) ? ' ' : ''));
}
