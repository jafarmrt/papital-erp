/**
 * v9.0.165 (TD-533، یافته B02-18): مرز نام و تصویر نمایه، مشترک مسیرهای کاربر و فرم‌ها. نام کاربر حداکثر ۱۰۰ نویسه است و
 * تصویر نمایه فقط تصویر بارگذاری‌شده (`data:image/...;base64`، که به `/uploads/` می‌رود) یا مسیر `/uploads/…` همین سامانه؛
 * پیش‌تر هر رشته‌ای، از نشانی ردیاب بیرونی تا یک میلیون نویسه، پذیرفته می‌شد و `list-simple` آن را به همه می‌داد.
 */

export const FULL_NAME_MAX_LENGTH = 100;

export const FULL_NAME_TOO_LONG_MESSAGE = 'نام و نام خانوادگی حداکثر ۱۰۰ نویسه است.';

export const AVATAR_INVALID_MESSAGE = 'تصویر نمایه باید فایلی باشد که در همین سامانه بارگذاری می‌شود (JPG، PNG، WEBP یا GIF).';

const STORED_AVATAR_PATH = /^\/uploads\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif)$/i;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i;

/** مسیر فایل تصویری که همین سامانه در `/uploads` ذخیره کرده است */
export function isStoredAvatarPath(value: string): boolean {
  return STORED_AVATAR_PATH.test(value);
}

/** تصویر تازه‌ای که فرم نمایه می‌فرستد و سرور آن را در `/uploads` ذخیره می‌کند */
export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL.test(value);
}

/** مقدار پذیرفتنی فیلد `avatar` نمایه: خالی، تصویر تازه یا مسیر ذخیره‌شده همین سامانه */
export function isAcceptableAvatar(value: string): boolean {
  return value === '' || isImageDataUrl(value) || isStoredAvatarPath(value);
}
