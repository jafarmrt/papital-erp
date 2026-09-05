import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1Updates } from './1';
import { v2Updates } from './2';
import { v3Updates } from './3';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، سری 1.x.y، سری 2.x.y و نسخه ۳ در 3.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v3Updates,
  ...v2Updates,
  ...v1Updates,
  ...v0Updates,
];
