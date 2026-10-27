/** The types a stored file is shown as inside the page, by the first bytes that prove them */
export type InlineSafeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_HEADER_WINDOW = 1024;

/**
 * v11 phase 6.2 (X16): the inline-safe type the first bytes of a file prove, or null. An upload is shown or stored as an
 * image or PDF only when its bytes are one; before, the type the browser declared was trusted.
 */
export function sniffInlineSafeType(head: Buffer): InlineSafeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.toString('latin1', 0, 6))) return 'image/gif';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // PDF readers accept the header anywhere in the first 1024 bytes (a BOM or a few junk bytes before it)
  if (head.subarray(0, PDF_HEADER_WINDOW).indexOf('%PDF-', 0, 'latin1') >= 0) return 'application/pdf';
  return null;
}
