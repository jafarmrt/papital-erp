import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1To6Updates } from './archive_1_6';
import { v7Updates } from './7';
import { v8Updates } from './8';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، آرشیو خلاصه سری‌های پیشین (۱ تا ۶)، سری بسته‌شده ۷ (7.ts، منجمد در v7.0.140)
 * و سری فعال ۸ در 8.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v8Updates,
  ...v7Updates,
  ...v1To6Updates,
  ...v0Updates,
];

/**
 * v8.0.0: سری فعال چنج‌لاگ — هر نسخه تازه فقط به این فایل اضافه می‌شود (AGENTS.md §7، §13، §23).
 * در گذار به سری بعد فقط همین ثابت و CLOSED_CHANGELOG_SERIES عوض می‌شوند.
 */
export const ACTIVE_CHANGELOG = {
  series: 8,
  file: 'src/data/changelogs/8.ts',
  updates: v8Updates,
};

/**
 * v8.0.0: سری‌های بسته‌شده و منجمد؛ `npm run check:version` (seriesGuard.ts) هر تغییر در آن‌ها را رد می‌کند.
 * sha256 = fingerprintChangelog(updates) هنگام بستن سری.
 */
export const CLOSED_CHANGELOG_SERIES = [
  {
    series: 7,
    finalVersion: 'v7.0.140',
    entryCount: 141,
    sha256: 'ee212f7713bc91e4a8424638c59ecf1b202ec555f29ace8696bcca6175d3140e',
    updates: v7Updates,
  },
];
