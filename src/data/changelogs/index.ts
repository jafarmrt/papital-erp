import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1To6Updates } from './archive_1_6';
import { v7Updates } from './7';
import { v8Updates } from './8';
import { v9Updates } from './9';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، آرشیو خلاصه سری‌های پیشین (۱ تا ۶)، سری‌های بسته‌شده ۷ (7.ts، منجمد در v7.0.140)
 * و ۸ (8.ts، منجمد در v8.0.128) و سری فعال ۹ در 9.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v9Updates,
  ...v8Updates,
  ...v7Updates,
  ...v1To6Updates,
  ...v0Updates,
];

/**
 * v8.0.0: سری فعال چنج‌لاگ — هر نسخه تازه فقط به این فایل اضافه می‌شود (AGENTS.md §7، §13، §23). از v9.0.0 سری ۹.
 * در گذار به سری بعد فقط همین ثابت و CLOSED_CHANGELOG_SERIES عوض می‌شوند.
 */
export const ACTIVE_CHANGELOG = {
  series: 9,
  file: 'src/data/changelogs/9.ts',
  updates: v9Updates,
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
  {
    series: 8,
    finalVersion: 'v8.0.128',
    entryCount: 129,
    sha256: '726c27f3f16d2dd0389b2444cc39f5959ea7a6befb4b5cab5ee9046ff8db39e6',
    updates: v8Updates,
  },
];
