import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1Updates } from './1';
import { v2Updates } from './2';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، سری 1.x.y در 1.ts و سری 2.x.y در 2.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v2Updates,
  ...v1Updates,
  ...v0Updates,
];
