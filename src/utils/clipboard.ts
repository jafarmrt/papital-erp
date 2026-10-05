/**
 * کپی متن در کلیپ‌بورد.
 * نبود Clipboard API (زمینه ناامن HTTP یا iframe بدون مجوز) یا رد مرورگر به false می‌رسد، نه به Promise رهاشده؛
 * فراخوان پیام «کپی شد» را فقط با true نشان می‌دهد.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
