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
  /** درخواست فهرست کامل در کد مرورگر */
  fullListFetch: RegExp;
  /** فایل‌های صفحه خود بخش که فهرست کامل را می‌خوانند */
  ownPages: readonly string[];
}

const SECTIONS: Record<string, Section> = {
  // v9.0.120 (TD-887)
  customers: {
    fullList: 'customers',
    ownGroups: ['customers.'],
    fullListFetch: /(?:fetch\w*(?:<[^>]*>)?\(\s*|fetchUrl=\{?\s*)['"`](?:\/api)?\/customers(?:\?|['"`])/,
    ownPages: ['hooks/queries/useCustomerQueries.ts'],
  },
};

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
      .filter(file => section.fullListFetch.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(readers).toEqual([]);
  });

  it('every pick list URL is an options endpoint of its section', () => {
    for (const url of Object.values(PICK_LIST_URLS)) expect(url).toMatch(/^\/[a-z-/]+\/options$/);
  });
});
