import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Package 16 (TD-686 / B16-22, decision t7): the shell, dashboard and settings UI text uses the owner's Persian words.
// Only «کاردکس», «ترنسفر» and «وبهوک» stay transliterated, and «اکسل» and «ووکامرس» are product names. Search keywords of
// the settings tabs are hidden aliases and keep the old words so old searches still find a tab.

const ROOT = join(__dirname, '..', '..');
const SHELL_UI = [
  'api.ts', 'components/ErrorBoundary.tsx', 'components/common/SectionErrorBoundary.tsx',
  'components/common/ModernPersianDropzone.tsx', 'components/layout/Sidebar.tsx', 'components/layout/SidebarSearch.tsx',
  'components/layout/TopBar.tsx', 'components/layout/menuConfig.ts', 'components/dashboard/CustomizableShortcuts.tsx',
  'components/dashboard/InteractiveJalaliCalendar.tsx', 'pages/Dashboard.tsx', 'pages/ChangelogPage.tsx',
  'data/appInfoAndChangelog.ts', 'components/settings/settingsNavigationConfig.ts', 'components/settings/SystemConfigTab.tsx',
  'components/settings/GeneralSettingsTab.tsx', 'components/settings/DataExportCard.tsx', 'pages/SettingsPage.tsx', 'components/GlobalHeaderSearch.tsx', 'pages/SetupPage.tsx',
  // v10.0.16 / v10.0.17 (D-11): the installable app's banners, install guide and the phone bottom bar
  'components/pwa/PwaStatusBanners.tsx', 'components/pwa/InstallAppButton.tsx', 'components/layout/MobileBottomNav.tsx', 'components/layout/mobileNavItems.ts',
];
const REPLACED = /داشبورد|ورکفلو|ورک‌فلو|تسک|متریال|آلارم|دیتابیس|سیستم|منو(?!ی[^\s])|فیلتر|سرور|پروفایل|آنلاین|آپلود|اتوماسیون|استراتژی|ماژول|پروتکل|توکن|فلگ|کانفیگ|اندپوینت|فرانت|بک‌اند|باندل|ری‌استارت/;
// v10.0.41 (TD-1159): the menu and the shell say «سند حسابداری» / «دوطرفه» (TD-579 glossary) and «فهرست», never «دوبل» or «لیست».
const ACCOUNTING_GLOSSARY = /دوبل|لیست/;
const ENGLISH = /TOMAN|Toman|Drag & Drop|Paste \(|\bKB\b|Tech Stack|AGENTS\.md|⌘K|Invalid time value/;

/** the code of a line, without comments, the hidden search keywords and the server message the client matches */
function shownCode(raw: string): string {
  const line = raw.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return '';
  if (/^keywords:/.test(line)) return '';
  return line.replace(/\s\/\/\s.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/includes\('توکن امنیتی'\)/g, '');
}

describe('Shell UI wording (TD-686)', () => {
  const lines = SHELL_UI.flatMap(file => readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((raw, i) => ({ where: `${file}:${i + 1}`, text: shownCode(raw) })));

  it('uses the decided Persian words, not the replaced transliterations', () => {
    expect(lines.filter(l => REPLACED.test(l.text)).map(l => `${l.where}: ${l.text}`)).toEqual([]);
  });

  it('uses the accounting glossary in the menu and shell: no «دوبل» or «لیست» (TD-1159)', () => {
    expect(lines.filter(l => ACCOUNTING_GLOSSARY.test(l.text)).map(l => `${l.where}: ${l.text}`)).toEqual([]);
  });

  it('shows no English words to the user', () => {
    expect(lines.filter(l => ENGLISH.test(l.text)).map(l => `${l.where}: ${l.text}`)).toEqual([]);
  });
});
