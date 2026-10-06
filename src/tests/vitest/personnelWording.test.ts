import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// v9.0.31 (TD-440، تصمیم فاز ۲ درباره آوانویسی): متن فارسی رابط پرسنل واژه انگلیسی («Update Existing»، «IBAN») و
// آوانویسی («اکانت»، «کلیپ‌بورد») ندارد؛ فقط «کاردکس» و «ترنسفر» آوانویسی مجازند و پسوند فایل (.xlsx) واژه نیست

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;

const PERSONNEL_UI = [
  'components/personnel/', 'pages/PersonnelPage.tsx', 'hooks/usePersonnel.ts', 'hooks/queries/usePersonnelQueries.ts',
];
const TRANSLITERATION = /اکانت|کلیپ[‌ ]?بورد/;
/** واژه لاتین در متن فارسی، جز پسوند فایل؛ نام مدرک و فناوری در نمونه مهارت‌ها (CNC، ICDL) واژه رابط نیست */
const LATIN_WORD = /(?<![.\w])[A-Za-z]{2,}/g;
const PROPER_ACRONYMS = new Set(['CNC', 'ICDL']);
const hasEnglishWord = (text: string) => (text.match(LATIN_WORD) ?? []).some(w => !PROPER_ACRONYMS.has(w));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('{/*')) return;
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      // جای‌گذاری‌های کد درون رشته قالبی متن رابط نیستند
      const shown = text.replace(/^[>'"`]|[<'"`]$/g, '').replace(/\$\{[^}]*\}/g, '');
      if (PERSIAN.test(shown)) found.push({ line: i + 1, text: shown });
    }
  });
  return found;
}

const files = sourceFiles(ROOT).filter(f => PERSONNEL_UI.some(p => relative(ROOT, f).replace(/\\/g, '/').startsWith(p)));

describe('Personnel UI wording (TD-440)', () => {
  it('reads the personnel UI files', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it('has no English words in Persian personnel UI text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => hasEnglishWord(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });

  it('has no «اکانت» or «کلیپ‌بورد» in personnel UI text', () => {
    const offenders = files.flatMap(f => persianTexts(f).filter(t => TRANSLITERATION.test(t.text)).map(t => `${relative(ROOT, f)}:${t.line}: ${t.text}`));
    expect(offenders).toEqual([]);
  });
});
