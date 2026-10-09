/**
 * v9.0.222 (TD-533، یافته B02-18): مرز نام و تصویر نمایه، مشترک مسیرهای کاربر و فرم‌ها. نام کاربر حداکثر ۱۰۰ نویسه است و
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

/**
 * v10.0.38 (TD-1161): the profile picture picker, its check and its hint name the formats the server stores
 * (`uploadBase64ToStorage`: JPG, PNG, WEBP, GIF). The picture is shrunk in the browser before it is sent
 * (`compressTo300KB`), so the hint names no size limit; it used to say «۵ مگابایت» while the picker left out GIF.
 */
export const PROFILE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export const PROFILE_IMAGE_ACCEPT = PROFILE_IMAGE_TYPES.join(', ');

export const PROFILE_IMAGE_HINT = 'قالب‌های مجاز: PNG، JPG، WEBP و GIF. تصویر بزرگ پیش از ارسال کوچک می‌شود.';

export const PROFILE_IMAGE_TYPE_MESSAGE = 'یک فایل تصویری انتخاب کنید (PNG، JPG، WEBP یا GIF).';

/** Whether a picked file is one of the formats the profile picture accepts */
export function isProfileImageType(type: string): boolean {
  return (PROFILE_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase());
}
