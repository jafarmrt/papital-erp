/**
 * v8.0.127 (TD-408): احراز هویت درخواست‌های REST ووکامرس. روی HTTPS کلید و رمز فقط در هدر Authorization (Basic) می‌روند؛
 * پیش‌تر در query string هم فرستاده می‌شدند و در لاگ دسترسی وب‌سرور و پروکسی فروشگاه می‌ماندند. فقط آدرس HTTP، که ووکامرس
 * در آن Basic را نمی‌پذیرد، کلید را در query string می‌گیرد.
 */
export function wcAuthQueryParams(
  url: string,
  params: Record<string, unknown>,
  key: string,
  secret: string,
): Record<string, unknown> {
  if (/^https:\/\//i.test(url.trim())) return { ...params };
  return { ...params, consumer_key: key, consumer_secret: secret };
}
