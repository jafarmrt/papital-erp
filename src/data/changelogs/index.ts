import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1Updates } from './1';
import { v2Updates } from './2';
import { v3Updates } from './3';
import { v4Updates } from './4';
import { v5Updates } from './5';
import { v6Updates } from './6';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، سری‌های پیشین (۱ تا ۵) و نسخه فعال ۶ در 6.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v6Updates,
  ...v5Updates,
  ...v4Updates,
  ...v3Updates,
  ...v2Updates,
  ...v1Updates,
  ...v0Updates,
];
