import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// v9.0.443 (TD-734, B15-32, decision t9 a): the events, webhook, notification and WooCommerce UI text uses the decided
// Persian words. «وب‌هوک» is the third allowed loanword; «اقدام», «آزمایش», «گزارش», «داده رویداد», «صف ارسال رویداد»,
// «صف خطا», «پردازشگر پس‌زمینه», «سرآیند», «آزمایش اتصال», «کلید», «اشاره» and «خودکارسازی» replace the old words, and
// the shell glossary applies too («سامانه», «کارساز», «برخط», «پایگاه‌داده», «جست‌وجو», «نشانی», «پالایش»). An English
// label of the WooCommerce or WordPress dashboard stays only inside parentheses, so the user can find it there.

const ROOT = join(__dirname, '..', '..');
const EVENTS_UI = [
  'components/NotificationBell.tsx', 'pages/DomainEventsPage.tsx', 'lib/eventPayloadFields.ts',
  'components/settings/AutoActionsSubTab.tsx', 'components/settings/DeadLetterQueueSubTab.tsx',
  'components/settings/DomainEventsTab.tsx', 'components/settings/EventFieldChips.tsx',
  'components/settings/EventSourcingReplaySubTab.tsx', 'components/settings/EventSimulationPanel.tsx',
  'components/settings/RuleEditorModal.tsx', 'components/settings/ShopWarehouseSelect.tsx',
  'components/settings/WcOrderLogStatusBadge.tsx', 'components/settings/WebhookManagementSubTab.tsx',
  'components/settings/WebhookSecretRevealPanel.tsx', 'components/settings/WooCommerceTab.tsx',
  'hooks/queries/useEventQueries.ts', 'hooks/queries/useNotificationQueries.ts',
];

const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;
/** the old words (t9 and the shell glossary), each only where it starts a Persian word */
const REPLACED = new RegExp(`(?<![؀-ۿ])(?:${[
  'اکشن', 'تست', 'لاگ', 'پی‌لود', 'اوت‌باکس', 'ورکر', 'پینگ', 'هدر', 'توکن', 'منشن', 'اتوماسیون', 'سرور', 'سیستم',
  'آنلاین', 'دیتابیس', 'اتمیک', 'ورکفلو', 'فیلد', 'فیلتر', 'رکورد', 'کلیپ‌بورد', 'جستجو', 'لیست', 'داشبورد', 'آدرس',
].join('|')})`);
/** a Latin word in Persian text outside parentheses, except a data format, an HTTP method or the signature algorithm */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
const ALLOWED_LATIN = new Set(['JSON', 'POST', 'PUT', 'HMAC', 'SHA']);

/** a source line without comments and without the code placed inside template literals */
function codeLine(raw: string): string {
  let line = raw.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return '';
  line = line.replace(/\s\/\/\s.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/\s[<>]=?\s|=>/g, ' ');
  while (/\$\{[^{}]*\}/.test(line)) line = line.replace(/\$\{[^{}]*\}/g, '');
  return line;
}

function persianTexts(file: string): Array<{ where: string; text: string }> {
  const found: Array<{ where: string; text: string }> = [];
  readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((raw, i) => {
    const line = codeLine(raw);
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const shown = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(shown)) found.push({ where: `${file}:${i + 1}`, text: shown });
    }
  });
  return found;
}

const texts = EVENTS_UI.flatMap(persianTexts);
const outsideParentheses = (text: string) => text.replace(/&[a-z]+;/g, ' ').replace(/\{\{[^}]*\}\}/g, '').replace(/\([^()]*\)/g, '');
const englishWords = (text: string) => (outsideParentheses(text).match(LATIN_WORD) ?? []).filter(w => !ALLOWED_LATIN.has(w));

describe('TD-734 events UI wording', () => {
  it('reads the Persian text of every events file', () => {
    expect(texts.length).toBeGreaterThan(300);
  });

  it('uses the decided Persian words, not the replaced loanwords', () => {
    expect(texts.filter(t => REPLACED.test(t.text)).map(t => `${t.where}: ${t.text}`)).toEqual([]);
  });

  it('shows English words only inside parentheses', () => {
    expect(texts.filter(t => englishWords(t.text).length > 0).map(t => `${t.where}: ${t.text}`)).toEqual([]);
  });
});
