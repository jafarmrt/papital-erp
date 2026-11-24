import { describe, expect, it } from 'vitest';
import {
  FORM_FIELDS_MAX, FORM_FIELD_KINDS, FORM_OPTIONS_MAX, FORM_SUBMIT_LABEL_DEFAULT, FORM_SUCCESS_DEFAULT, checkedForm, contactFormTemplate, emptyField, formParagraphs,
  nextFieldId,
} from '../../lib/storefront/storefrontFormRules';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): the rules of «فرم‌های سایت» that the server and
 * the screen share: a form is rebuilt from its known fields, every text is plain text, and what is not known is
 * refused with its message and the place of the field it is in.
 */
const field = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'f1', kind: 'shortText', label: 'نام', required: false, help: '', options: [], ...over });
const form = (over: Record<string, unknown> = {}) => ({ key: 'contact', title: 'تماس با ما', intro: '', fields: [field()], submitLabel: '', successMessage: '', ...over });
const problemOf = (raw: unknown, forSite = false) => checkedForm(raw, { forSite }).problem;

describe('the rules of a form of the site', () => {
  it('keeps a form as its known fields alone, with its words trimmed and its defaults', () => {
    const checked = checkedForm(form({
      title: '  تماس   با ما ', intro: ' بند یک \r\n\r\n\r\n بند دو ', submitLabel: '', successMessage: '  ',
      fields: [field({ label: ' نام  کامل ', help: ' راهنما ' }), field({ id: 'f2', kind: 'choices', label: 'موضوع', options: [' فروش ', 'پشتیبانی'], required: true })],
    }), { forSite: true });
    expect(checked.problem).toBeNull();
    expect(checked.form).toEqual({
      key: 'contact', title: 'تماس با ما', intro: 'بند یک\n\nبند دو', submitLabel: FORM_SUBMIT_LABEL_DEFAULT, successMessage: FORM_SUCCESS_DEFAULT,
      fields: [
        { id: 'f1', kind: 'shortText', label: 'نام کامل', required: false, help: 'راهنما', options: [] },
        { id: 'f2', kind: 'choices', label: 'موضوع', required: true, help: '', options: ['فروش', 'پشتیبانی'] },
      ],
    });
  });

  it('takes markup as the plain text it is', () => {
    const checked = checkedForm(form({ title: '<b>تماس</b>', fields: [field({ label: '<img src=x onerror=alert(1)>' })] }), { forSite: true });
    expect(checked.form?.title).toBe('<b>تماس</b>');
    expect(checked.form?.fields[0].label).toBe('<img src=x onerror=alert(1)>');
  });

  it('refuses what it does not know, naming the field it is in', () => {
    const cases: Array<[Record<string, unknown>, string, number]> = [
      [form({ fields: [field(), field({ id: 'f2', label: 'دوم', style: 'x' })] }), 'STOREFRONT_FORM_FIELD_UNKNOWN', 1],
      [form({ fields: [field({ kind: 'file' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ label: '' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ id: 'F1' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      // a name is f1, f2, … alone: never a word an object or a form element has a meaning for
      ...['constructor', 'submit', 'action', 'length', 'f0', 'f', 'f12345', '1'].map((id): [Record<string, unknown>, string, number] => [form({ fields: [field({ id })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0]),
      // a name nobody can see is no name, and two names that read the same are one name
      [form({ fields: [field({ label: String.fromCharCode(0x200b, 0x200c, 0x200f) })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ label: 'کریمی' }), field({ id: 'f2', label: 'كريمي' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 1],
      [form({ fields: [field({ label: 'می‌خواهم' }), field({ id: 'f2', label: 'می خواهم' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 1],
      [form({ fields: [field({ label: 'Email' }), field({ id: 'f2', label: 'email' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 1],
      [form({ fields: [field({ kind: 'choice', options: ['کریمی', 'كريمي'] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'choice', options: ['الف', String.fromCharCode(0x200b)] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'consent', label: 'ق'.repeat(301) })] }), 'STOREFRONT_FORM_FIELD_TOO_LONG', 0],
      [form({ fields: [field(), field({ label: 'دوم' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 1],
      [form({ fields: [field(), field({ id: 'f2' })] }), 'STOREFRONT_FORM_FIELD_INVALID', 1],
      [form({ fields: [field({ options: ['الف', 'ب'] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'choice', options: ['الف'] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'choice', options: ['الف', ''] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'choice', options: ['الف', 'الف'] })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: [field({ kind: 'choice', options: Array.from({ length: FORM_OPTIONS_MAX + 1 }, (_, i) => `گزینه ${i}`) })] }), 'STOREFRONT_FORM_TOO_MANY', 0],
      [form({ fields: [field({ required: 1 })] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
      [form({ fields: ['نام'] }), 'STOREFRONT_FORM_FIELD_INVALID', 0],
    ];
    for (const [raw, code, index] of cases) {
      const problem = problemOf(raw);
      expect(problem, JSON.stringify(raw.fields)).toMatchObject({ field: 'fields', code, index });
    }
    expect(problemOf(form({ fields: Array.from({ length: FORM_FIELDS_MAX + 1 }, (_, i) => field({ id: `f${i + 1}`, label: `فیلد ${i + 1}` })) }))).toMatchObject({ code: 'STOREFRONT_FORM_TOO_MANY', index: -1 });
    expect(problemOf(form({ fields: 'f1' }))).toMatchObject({ field: 'fields', index: -1 });
    expect(problemOf(null)).toMatchObject({ code: 'STOREFRONT_FORM_INVALID' });
  });

  it('refuses a key, a title and words of another shape', () => {
    for (const key of ['', 'Contact', 'contact us', 'contact_us', '-contact', 'تماس', 'a'.repeat(61), 7]) expect(problemOf(form({ key })), String(key)).toMatchObject({ field: 'key', code: 'STOREFRONT_FORM_KEY_INVALID' });
    expect(problemOf(form({ title: '  ' }))).toMatchObject({ field: 'title' });
    expect(problemOf(form({ title: String.fromCharCode(0x200b, 0x2060) }))).toMatchObject({ field: 'title' });
    // half an emoji is no text the database keeps
    expect(problemOf(form({ intro: `متن${String.fromCharCode(0xd83d)}` }))).toMatchObject({ field: 'intro' });
    // the sentence beside a tick may be longer than a field's name
    expect(problemOf(form({ fields: [field({ kind: 'consent', label: 'ق'.repeat(300) }), field({ id: 'f2' })] }))).toBeNull();
    expect(problemOf(form({ fields: [field({ label: 'ن'.repeat(81) })] }))).toMatchObject({ code: 'STOREFRONT_FORM_FIELD_TOO_LONG' });
    expect(problemOf(form({ title: 'الف'.repeat(121) }))).toMatchObject({ field: 'title', code: 'STOREFRONT_FORM_FIELD_TOO_LONG' });
    expect(problemOf(form({ intro: 5 }))).toMatchObject({ field: 'intro' });
    expect(problemOf(form({ intro: `متن${String.fromCharCode(0x202e)}` }))).toMatchObject({ field: 'intro' });
    expect(problemOf(form({ intro: 'ا'.repeat(1001) }))).toMatchObject({ field: 'intro', code: 'STOREFRONT_FORM_FIELD_TOO_LONG' });
    expect(problemOf(form({ submitLabel: 'ب'.repeat(41) }))).toMatchObject({ field: 'submitLabel' });
    expect(problemOf(form({ successMessage: `پیام${String.fromCharCode(7)}` }))).toMatchObject({ field: 'successMessage' });
  });

  it('lets a form without fields be saved, and not be on the site; nor one of ticks alone', () => {
    expect(problemOf(form({ fields: [] }))).toBeNull();
    expect(problemOf(form({ fields: [] }), true)).toMatchObject({ code: 'STOREFRONT_FORM_EMPTY' });
    expect(problemOf(form({ fields: [field({ kind: 'consent', label: 'می‌پذیرم' })] }), true)).toMatchObject({ code: 'STOREFRONT_FORM_EMPTY' });
    expect(problemOf(form({ fields: [field({ kind: 'consent', label: 'می‌پذیرم' }), field({ id: 'f2' })] }), true)).toBeNull();
  });

  it('gives a new field a name of its own, and each kind its start', () => {
    expect(nextFieldId([])).toBe('f1');
    // one past the highest, so the name of a field removed on the screen is not given to the next one
    expect(nextFieldId([{ id: 'f1' }, { id: 'f3' }])).toBe('f4');
    expect(nextFieldId([{ id: 'f12' }, { id: 'f3' }])).toBe('f13');
    expect(emptyField('choice', [{ id: 'f1' }])).toEqual({ id: 'f2', kind: 'choice', label: '', required: false, help: '', options: ['', ''] });
    expect(emptyField('consent', [])).toMatchObject({ required: true, options: [] });
    // every kind the screen offers passes the rules once it has a name (and, for a choice, its options)
    for (const kind of FORM_FIELD_KINDS) {
      const made = { ...emptyField(kind, []), label: 'عنوان' };
      expect(problemOf(form({ fields: [made.options.length ? { ...made, options: ['الف', 'ب'] } : made] })), kind).toBeNull();
    }
  });

  it('has a contact form template that passes its own rules and may go on the site', () => {
    const checked = checkedForm({ key: 'contact', title: 'تماس با ما', ...contactFormTemplate() }, { forSite: true });
    expect(checked.problem).toBeNull();
    expect(checked.form?.fields.map(f => `${f.kind}:${f.required}`)).toEqual(['shortText:true', 'mobile:false', 'email:false', 'shortText:false', 'longText:true']);
  });

  it('keeps paragraphs as lines with one blank line between them', () => {
    expect(formParagraphs('  یک  \n\n\n\n دو\tسه \n')).toBe('یک\n\nدو سه');
  });
});
