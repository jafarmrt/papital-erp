/**
 * v10.2 package 7: the name a download is saved under ends with the extension of the stored type («فاکتور.pdf» stored
 * as an image becomes «فاکتور.jpg»), so a browser never opens it as another kind; a type without a known extension
 * keeps the name as sent. Shared by `GET /api/attachments/:id` and the browser's download link, which names the file
 * itself.
 * 10.3 package 7: only a known file extension is replaced; a dot inside the name is kept («Report v1.2 final» stored as
 * a PDF is «Report v1.2 final.pdf», never «Report v1.pdf»).
 */

/** The extension each stored type is saved with */
export const ATTACHMENT_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Endings a sent name may carry that are a file extension and are replaced by the stored type's */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(ATTACHMENT_EXTENSION_BY_MIME),
  'jpeg', 'jpe', 'jfif', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'svg',
  'odt', 'ods', 'odp', 'rtf', 'ppt', 'pptx', 'json', 'xml', 'md', 'log', 'tsv', 'html', 'htm',
  'zip', 'rar', '7z', 'gz', 'tar', 'mp3', 'mp4', 'mov', 'wav', 'bin',
]);

export function attachmentDownloadName(name: string, mimeType: string): string {
  const base = name.trim() || 'attachment';
  const ext = ATTACHMENT_EXTENSION_BY_MIME[mimeType];
  if (!ext) return base;
  const ending = /\.([^./\\\s]{1,10})$/.exec(base)?.[1]?.toLowerCase();
  const current = ending && KNOWN_EXTENSIONS.has(ending) ? ending : undefined;
  if (current === ext || (ext === 'jpg' && current === 'jpeg')) return base;
  const stem = current ? base.slice(0, -(current.length + 1)) : base;
  return `${stem || 'attachment'}.${ext}`;
}
