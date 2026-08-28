import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1Updates } from './1';

export type { AIUpdateLog };

/**
 * V10 — بعد از ریست نسخه‌گذاری، این آرایه از فایل پایه 0.ts (نسخه 1.0.0)
 * و سپس فایل‌های فعال سری 1.x.y تغذیه می‌شود.
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v1Updates,
  ...v0Updates,
];
