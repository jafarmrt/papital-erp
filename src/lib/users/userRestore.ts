/**
 * v9.0.178 (TD-519، یافته B02-04، تصمیم ت۲ الف): کاربر تازه همیشه شناسه تازه می‌گیرد. ساختن کاربر با نام کاربری یک کاربر
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

/**
 * v10.0.75 (TD-1162): a user is only soft-deleted and comes back through `POST /users/:id/restore`, which the user form
 * offers when a new user takes a deleted user's username (TD-519); the delete confirmation used to say it cannot be undone.
 */
export const DELETE_USER_CONFIRM_MESSAGE =
  'آیا از حذف این کاربر اطمینان دارید؟ او دیگر نمی‌تواند وارد سامانه شود. برای بازگرداندنش، کاربری تازه با همان نام کاربری بسازید تا فرم، بازگردانی را پیشنهاد دهد.';
