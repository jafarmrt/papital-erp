/**
 * OBS-R1-30 (product-owner decision ت۴۰ item 8): the rule of a new username, shared by the server (`POST /users`,
 * `POST /setup`) and the forms (user form, setup wizard). A new username is 3 to 50 Latin letters, digits, «.», «_» or
 * «-», and two usernames that differ only in letter case or surrounding spaces are one username (`usernameKey`, the
 * key of the unique index `uq_users_username_key` of migration 0124). Old usernames are never changed and still log in.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;

export const USERNAME_FORMAT_INVALID = 'USERNAME_FORMAT_INVALID';

export const USERNAME_FORMAT_MESSAGE =
  'نام کاربری باید ۳ تا ۵۰ نویسه و فقط حرف لاتین، رقم لاتین، نقطه، زیرخط یا خط تیره باشد.';

/**
 * The key two usernames are compared by: letter case and surrounding spaces do not count. Only the space character is
 * stripped, like SQL `btrim` of the unique index, so an old username with a tab or a no-break space keys alike in both.
 */
export function usernameKey(username: string): string {
  return String(username ?? '').replace(/^ +| +$/g, '').toLowerCase();
}

/** Why a new username may not be saved, or null */
export function usernameFormatError(username: string): string | null {
  return USERNAME_PATTERN.test(String(username ?? '').trim()) ? null : USERNAME_FORMAT_MESSAGE;
}
