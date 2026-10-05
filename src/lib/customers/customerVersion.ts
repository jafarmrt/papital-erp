/**
 * v8.0.122 (TD-403): قفل خوش‌بینانه طرف حساب در مرورگر. ویرایش نسخه رکوردی را که فرم از آن ساخته شده می‌فرستد و ستون
 * «نسخه» فایل خروجی اکسل در درون‌ریزی دوباره برمی‌گردد؛ سرور نسخه کهنه را رد می‌کند.
 */

/** بدنه ذخیره طرف حساب: ویرایش همراه نسخه، ثبت تازه بی نسخه */
export function customerSaveBody<T extends object>(payload: T, editingId: number | null, editingVersion: number | undefined): T & { version?: number } {
  return editingId !== null ? { ...payload, version: editingVersion } : payload;
}

/** نسخه ردیف فایل اکسل (ستون «نسخه»)؛ خالی یا نادرست = بی نسخه */
export function excelRowVersion(raw: string): number | undefined {
  const value = Number(String(raw ?? '').trim());
  return String(raw ?? '').trim() !== '' && Number.isInteger(value) && value > 0 ? value : undefined;
}
