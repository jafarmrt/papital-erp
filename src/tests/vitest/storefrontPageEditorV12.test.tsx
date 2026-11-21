import { describe, expect, it, vi } from 'vitest';
import { generateJSON } from '@tiptap/core';
import { safeRichDoc } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10b: the text editor's schema against the server's rules (`storefrontPageRichText.ts`). Every kind of content
 * the editor holds is taken by the server in the shape the editor writes it; the editor's quote, list item and table cell
 * are narrowed to the server's shapes; and what a paste brings from outside the schema never becomes part of a text.
 */
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: () => true };
});

const { pageEditorExtensions } = await import('../../components/storefront/pages/RichTextEditor');
const parse = (html: string) => generateJSON(html, pageEditorExtensions());

describe('the page text editor', () => {
  it('holds every kind of content the server takes, in the shape the server takes', () => {
    const json = parse([
      '<h2 style="text-align: center">تیتر</h2>',
      '<p>متن <strong>پررنگ</strong> <em>کج</em> <u>زیرخط</u> <a href="/about">پیوند درون سایت</a> <a href="https://example.com/a">پیوند بیرون</a> <span data-text-color="accent">رنگی</span><br>خط دوم</p>',
      '<ul><li><p>یک</p><ol><li><p>تو در تو</p></li></ol></li></ul>',
      '<blockquote><p>نقل</p></blockquote>',
      '<hr>',
      '<img data-asset-id="12" alt="عکس کارگاه">',
      '<table><tbody><tr><th><p>الف</p></th><th><p>ب</p></th></tr><tr><td><p>۱</p></td><td><p>۲</p></td></tr></tbody></table>',
    ].join(''));
    const checked = safeRichDoc(json);
    expect(checked.problem).toBeNull();
    const kinds = (checked.doc?.content ?? []).map(node => node.type);
    expect(kinds).toEqual(expect.arrayContaining(['heading', 'paragraph', 'bulletList', 'blockquote', 'horizontalRule', 'libraryImage', 'table']));
    const text = JSON.stringify(checked.doc);
    for (const mark of ['bold', 'italic', 'underline', 'textColor', 'link']) expect(text, mark).toContain(`"type":"${mark}"`);
    expect(text).toContain('"href":"/about"');
    expect(text).toContain('"href":"https://example.com/a"');
    expect(text).toContain('"color":"accent"');
    expect(text).toContain('"textAlign":"center"');
    expect(text).toContain('"type":"hardBreak"');
    expect(text).toContain('"type":"orderedList"');
    expect(text).toContain('"type":"tableHeader"');
    expect(checked.doc?.content.find(node => node.type === 'libraryImage')).toEqual({ type: 'libraryImage', attrs: { assetId: 12, alt: 'عکس کارگاه' } });
  });

  it('drops what a paste brings from outside its schema: scripts, frames, images by address, code, styles', () => {
    const json = parse([
      '<p onclick="alert(1)" style="position:fixed">متن</p>',
      '<script>alert(1)</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<img src="https://evil.example/x.png" onerror="alert(1)">',
      '<pre><code>code</code></pre>',
      '<p><s>خط‌خورده</s> <code>کد</code> <span style="color: red">رنگ آزاد</span></p>',
      '<h1>تیتر یک</h1>',
    ].join(''));
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/alert|iframe|evil\.example|onclick|onerror|position|"type":"(strike|code|codeBlock|heading)"|"marks"/);
    // only the words themselves are left, as plain paragraphs
    expect((json.content as Array<{ type: string }>).every(node => node.type === 'paragraph')).toBe(true);
    expect(text).not.toContain('libraryImage');
    // what is left is plain content the server takes
    expect(safeRichDoc(json).problem).toBeNull();
  });

  it('takes no shape the server refuses: a quote and a table cell hold paragraphs, a list item a paragraph and then lists (10b review)', () => {
    // red before: the editor's own schema let a list or an image into a table cell, a list into a quote and a rule into
    // a list item, each of which the save then refused by its English name
    const nested = parse([
      '<table><tbody><tr><td><ul><li><p>فهرست در خانه</p></li></ul><h2>تیتر در خانه</h2><img data-asset-id="5" alt=""><hr></td></tr></tbody></table>',
      '<blockquote><ul><li><p>فهرست در نقل</p></li></ul><h3>تیتر در نقل</h3></blockquote>',
      '<ul><li><p>گزینه</p><hr><img data-asset-id="6" alt=""><blockquote><p>نقل در گزینه</p></blockquote><ol><li><p>تو در تو</p></li></ol></li></ul>',
    ].join(''));
    expect(safeRichDoc(nested).problem).toBeNull();
    const shape = JSON.stringify(nested);
    // whatever the editor made of them, the words are all still there
    for (const words of ['فهرست در خانه', 'تیتر در خانه', 'فهرست در نقل', 'تیتر در نقل', 'گزینه', 'نقل در گزینه', 'تو در تو']) expect(shape, words).toContain(words);
  });

  it('keeps a link only to this site or an https address', () => {
    const json = parse('<p><a href="javascript:alert(1)">یک</a> <a href="http://example.com">دو</a> <a href="https://example.com">سه</a> <a href="/about">چهار</a></p>');
    const hrefs = (JSON.stringify(json).match(/"href":"[^"]*"/g) ?? []).map(h => h.slice(8, -1));
    // the editor itself keeps only the last two; the words of the others stay as plain text
    expect(hrefs).toEqual(['https://example.com', '/about']);
    expect(safeRichDoc(json).problem).toBeNull();
  });
});
