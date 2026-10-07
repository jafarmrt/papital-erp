import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { READ_PERMISSIONS } from '../../lib/recordReadPermissions';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';

// مدل مجوز بسته ۲، تصمیم ت۱۰ الف: فرم بخش دیگر از فهرست انتخاب همان بخش می‌خواند و فهرست کامل هر بخش فقط با مجوز همان
// بخش باز است. این آزمون هر دو سو را نگه می‌دارد: کلیدهای فهرست کامل فقط از گروه خود بخش‌اند، و کد مرورگر بیرون از صفحه
// همان بخش فهرست کامل را نمی‌خواند. هر بخش با انتشار خودش به جدول زیر اضافه می‌شود.

const ROOT = join(__dirname, '..', '..');

interface Section {
  /** فهرست کامل در READ_PERMISSIONS */
  fullList: keyof typeof READ_PERMISSIONS;
  /** پیشوند کلیدهای خود بخش */
  ownGroups: readonly string[];
  /** درخواست فهرست کامل در کد مرورگر (پرچم g؛ درخواست نوشتن با `method` به همان نشانی شمرده نمی‌شود) */
  fullListFetch: RegExp;
  /** فایل‌های صفحه خود بخش که فهرست کامل را می‌خوانند */
  ownPages: readonly string[];
}

const SECTIONS: Record<string, Section> = {
  // v9.0.120 (TD-887)
  customers: {
    fullList: 'customers',
    ownGroups: ['customers.'],
    fullListFetch: /(?:fetch\w*(?:<[^>]*>)?\(\s*|fetchUrl=\{?\s*)['"`](?:\/api)?\/customers(?:\?|['"`])/g,
    ownPages: ['hooks/queries/useCustomerQueries.ts'],
  },
  // v9.0.121 (TD-888)
  items: {
    fullList: 'items',
    ownGroups: ['products.'],
    fullListFetch: /(?:fetch\w*(?:<[^>]*>)?\(\s*|fetchUrl=\{?\s*)['"`](?:\/api)?\/items(?:\?|['"`])/g,
    ownPages: ['hooks/queries/useItemQueries.ts', 'pages/GalleryPage.tsx', 'pages/PricingPage.tsx', 'components/excel/useUnifiedExcelImport.ts'],
  },
  // v9.0.122 (TD-889)
  projects: {
    fullList: 'projects',
    ownGroups: ['projects.'],
    fullListFetch: /(?:fetch\w*(?:<[^>]*>)?\(\s*|fetchUrl=\{?\s*)['"`](?:\/api)?\/projects(?:\?|['"`])/g,
    ownPages: ['hooks/queries/useProjectQueries.ts'],
  },
};

/** درخواست خواندن فهرست کامل در متن فایل؛ فراخوانی‌ای که در همان چند خط `method` نوشتن دارد (POST و …) خواندن نیست */
function readsFullList(source: string, pattern: RegExp): boolean {
  for (const match of source.matchAll(pattern)) {
    const call = source.slice(match.index, match.index + 200);
    if (!/method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/.test(call)) return true;
  }
  return false;
}

function browserFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(ROOT, path).replace(/\\/g, '/');
    if (['tests', 'routes', 'services', 'db', 'middleware', 'data'].includes(rel)) return [];
    if (statSync(path).isDirectory()) return browserFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

describe('pick lists for forms, full lists by the section\'s own permission (t10)', () => {
  it.each(Object.entries(SECTIONS))('the full %s list opens only with the section\'s own keys', (_name, section) => {
    const foreign = READ_PERMISSIONS[section.fullList].filter(key => !section.ownGroups.some(prefix => key.startsWith(prefix)));
    expect(foreign).toEqual([]);
  });

  it.each(Object.entries(SECTIONS))('browser code outside the %s pages reads only the pick list', (_name, section) => {
    const readers = browserFiles(ROOT)
      .filter(file => !section.ownPages.includes(file))
      .filter(file => readsFullList(readFileSync(join(ROOT, file), 'utf8'), section.fullListFetch));
    expect(readers).toEqual([]);
  });

  it('every pick list URL is an options endpoint of its section', () => {
    for (const url of Object.values(PICK_LIST_URLS)) expect(url).toMatch(/^\/[a-z-/]+\/options$/);
  });
});
