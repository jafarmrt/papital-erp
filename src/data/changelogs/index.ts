import { AIUpdateLog } from './types';
import { v0Updates } from './0';
import { v1To6Updates } from './archive_1_6';
import { v7Updates } from './7';
import { v8Updates } from './8';
import { v9Updates } from './9';
import { v10Updates } from './10';
import { v11Updates } from './11';

export type { AIUpdateLog };

/**
 * تجمیع چنج‌لاگ‌های نسخه پایه 0.ts، آرشیو خلاصه سری‌های پیشین (۱ تا ۶)، سری‌های بسته‌شده ۷ (7.ts، منجمد در v7.0.140)،
 * ۸ (8.ts، منجمد در v8.0.128)، ۹ (9.ts، منجمد در v10.0.0) و ۱۰ (10.ts، منجمد در v11.0.0) و سری فعال ۱۱ در 11.ts
 */
export const SYSTEM_UPDATES: AIUpdateLog[] = [
  ...v11Updates,
  ...v10Updates,
  ...v9Updates,
  ...v8Updates,
  ...v7Updates,
  ...v1To6Updates,
  ...v0Updates,
];

/**
 * v8.0.0: سری فعال چنج‌لاگ — هر نسخه تازه فقط به این فایل اضافه می‌شود (AGENTS.md §7، §13، §23). از v9.0.0 سری ۹،
 * از v10.0.0 سری ۱۰ و از v11.0.0 سری ۱۱. در گذار به سری بعد فقط همین ثابت و CLOSED_CHANGELOG_SERIES عوض می‌شوند.
 */
export const ACTIVE_CHANGELOG = {
  series: 11,
  file: 'src/data/changelogs/11.ts',
  updates: v11Updates,
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
  {
    series: 9,
    finalVersion: 'v9.0.461',
    entryCount: 462,
    sha256: 'c1a79c201cdb1dd6b3317ed690dbb770d09338fa53dbff42bf453dbb9784bda2',
    updates: v9Updates,
  },
  {
    series: 10,
    finalVersion: 'v10.3.24',
    entryCount: 413,
    sha256: '2a0ffe90088d053b0158e3f96feb8c9a33fb2ebb0c6ab7e48fe2d391866b5ef5',
    updates: v10Updates,
  },
];
