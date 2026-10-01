import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1To6Updates } from './archive_1_6';
import { v7Updates } from './7';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، آرشیو خلاصه سری‌های پیشین (۱ تا ۶) و نسخه فعال ۷ در 7.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v7Updates,
  ...v1To6Updates,
  ...v0Updates,
];

