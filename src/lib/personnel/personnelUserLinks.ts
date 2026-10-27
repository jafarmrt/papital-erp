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

/**
 * v11 phase 6.2 (X6): the linked account sees the person's payslips with the full card number («فیش‌های من»), so linking
 * or unlinking an account is a rights change: it needs «مدیریت کاربران», and a linked person is first saved without an
 * account before another one is linked. Before, «مدیریت پرسنل» alone moved anyone's payslips to any account.
 */
export const PERSONNEL_USER_LINK_PERMISSION = 'users.manage';

export const PERSONNEL_USER_LINK_FORBIDDEN_MESSAGE =
  'وصل کردن پرسنل به حساب کاربری یا برداشتن آن با کسی است که «مدیریت کاربران» دارد؛ آن حساب فیش‌های حقوق و شماره کارت این پرسنل را می‌بیند.';

export const PERSONNEL_USER_RELINK_MESSAGE =
  'این پرسنل به حساب کاربری دیگری وصل است؛ نخست «بدون حساب کاربری» را ذخیره کنید، سپس حساب تازه را وصل کنید.';
