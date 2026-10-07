/**
 * v9.0.241 (TD-791): آیا کاربری با این مجوزها کلید داده‌شده را دارد (مدیر سامانه همیشه). همان قاعده `useHasPermission`
 * (`src/contexts/AuthContext.tsx`)، بیرون از React تا قلاب‌هایی که چند کلید را با هم می‌سنجند همان را به کار ببرند.
 * فقط برای نمایش است؛ سرور همان مجوز را خودش می‌سنجد (`can`).
 */
export interface PermissionHolder {
  permissions?: readonly string[] | null;
  isAdmin?: boolean;
}

export function userHoldsPermission(holder: PermissionHolder | null | undefined, permission: string): boolean {
  if (!holder) return false;
  return holder.isAdmin === true || (Array.isArray(holder.permissions) && holder.permissions.includes(permission));
}
