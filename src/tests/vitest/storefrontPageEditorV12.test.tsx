import { describe, expect, it, vi } from 'vitest';
import { generateJSON } from '@tiptap/core';
import { safeRichDoc } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10b: the text editor's schema and the server's rules agree. Whatever the editor can hold is what the server
 * takes (`storefrontPageRichText.ts`), and what a paste brings from outside the schema never becomes part of a text.
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

  it('keeps a link only to this site or an https address', () => {
    const json = parse('<p><a href="javascript:alert(1)">یک</a> <a href="http://example.com">دو</a> <a href="https://example.com">سه</a></p>');
    const hrefs = JSON.stringify(json).match(/"href":"[^"]*"/g) ?? [];
    // whatever the editor kept of the first two, the server refuses any that is not a path or https
    const checked = safeRichDoc(json);
    if (hrefs.some(h => h.includes('javascript:') || h.includes('http://'))) expect(checked.problem?.code).toBe('STOREFRONT_PAGE_LINK_INVALID');
    else expect(checked.problem).toBeNull();
    expect(JSON.stringify(json)).not.toContain('javascript:');
  });
});
