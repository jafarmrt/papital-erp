import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1Updates } from './1';
import { v2Updates } from './2';
import { v3Updates } from './3';
import { v4Updates } from './4';
import { v5Updates } from './5';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، سری 1.x.y، سری 2.x.y، آرشیو ۳ و ۴ در 3.ts و 4.ts، و نسخه فعال ۵ در 5.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v5Updates,
  ...v4Updates,
  ...v3Updates,
  ...v2Updates,
  ...v1Updates,
  ...v0Updates,
];
