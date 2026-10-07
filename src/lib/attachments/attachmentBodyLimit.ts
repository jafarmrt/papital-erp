/**
 * v9.0.255 (TD-641, finding B13-16, product-owner decision ت۴): one size limit for attachments in every layer.
 *
 * A file may be at most 10 MiB (`MAX_ATTACHMENT_FILE_MB`, the attachment service and the upload box), and the save
 * routes of the records that carry attachments accept a JSON body of 14 MB (`ATTACHMENT_BODY_LIMIT`), enough for one
 * 10 MiB file as a data URL; every other route keeps 5 MB. A larger body is refused with a Persian 413.
 */
export const MAX_ATTACHMENT_FILE_MB = 10;
export const DEFAULT_BODY_LIMIT = '5mb';
export const ATTACHMENT_BODY_LIMIT = '14mb';

/** POST / PUT routes whose body may carry attachment data URLs (documents, vouchers, treasury, cheques, projects) */
const ATTACHMENT_BODY_ROUTES: Array<[string, RegExp]> = [
  ['POST', /^\/api\/documents\/?$/],
  ['PUT', /^\/api\/documents\/\d+\/?$/],
  ['POST', /^\/api\/accounting\/vouchers\/?$/],
  ['PUT', /^\/api\/accounting\/vouchers\/\d+\/?$/],
  ['POST', /^\/api\/accounting\/treasury\/?$/],
  ['POST', /^\/api\/accounting\/cheques\/?$/],
  ['POST', /^\/api\/projects\/?$/],
  ['PUT', /^\/api\/projects\/\d+\/?$/],
];

export function acceptsAttachmentBody(method: string, path: string): boolean {
  const p = path.split('?')[0];
  return ATTACHMENT_BODY_ROUTES.some(([m, pattern]) => m === method.toUpperCase() && pattern.test(p));
}

export const BODY_TOO_LARGE_MESSAGE =
  'حجم درخواست بیش از حد مجاز است؛ هر پیوست حداکثر ۱۰ مگابایت است و پیوست‌های بزرگ را در چند نوبت ذخیره کنید.';
