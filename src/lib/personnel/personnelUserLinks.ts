/**
 * v9.0.24 (TD-435): هر کاربر سامانه حداکثر به یک پرسنل فعال وصل می‌شود. فرم پرسنل کاربری را که به پرسنل دیگری وصل است
 * با نام آن پرسنل نشان می‌دهد و انتخابش را می‌بندد (سرور همان را با ۴۰۹ رد می‌کند).
 */
export interface PersonnelUserLinkSource {
  id: number;
  userId?: number | string | null;
  fullName?: string | null;
}

/** نام پرسنلِ وصل به هر کاربر، جز پرسنلی که در حال ویرایش است */
export function usersLinkedToOtherPersonnel(personnelList: readonly PersonnelUserLinkSource[], editingId: number | null): Map<number, string> {
  const linked = new Map<number, string>();
  for (const p of Array.isArray(personnelList) ? personnelList : []) {
    const userId = Number(p.userId);
    if (!userId || p.id === editingId || linked.has(userId)) continue;
    linked.set(userId, p.fullName || 'بی‌نام');
  }
  return linked;
}
