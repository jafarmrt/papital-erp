/**
 * v9.0.170 (TD-519، یافته B02-04، تصمیم ت۲ الف): کاربر تازه همیشه شناسه تازه می‌گیرد. ساختن کاربر با نام کاربری یک کاربر
 * حذف‌شده با این کد رد می‌شود و پاسخ، کاربر حذف‌شده را در `details.deletedUser` می‌آورد تا فرم کاربر «بازگرداندن همان
 * کاربر» را جداگانه پیشنهاد کند (`POST /users/:id/restore`). سرور و مرورگر همین ثابت را می‌خوانند.
 */
export const USERNAME_OF_DELETED_USER = 'USERNAME_OF_DELETED_USER';

export interface DeletedUserMatch {
  id: number;
  username: string;
  fullName: string | null;
}

export function deletedUsernameMessage(deletedUserName: string): string {
  return `این نام کاربری متعلق به کاربر حذف‌شده «${deletedUserName}» است؛ نام دیگری انتخاب کنید یا همان کاربر را بازگردانید.`;
}

/** کاربر حذف‌شده‌ای که پاسخ ۴۰۹ ساخت کاربر آورده است، یا null */
export function deletedUserOf(details: unknown): DeletedUserMatch | null {
  const match = (details as { deletedUser?: Partial<DeletedUserMatch> } | null | undefined)?.deletedUser;
  if (!match || typeof match.id !== 'number' || typeof match.username !== 'string') return null;
  return { id: match.id, username: match.username, fullName: typeof match.fullName === 'string' ? match.fullName : null };
}
