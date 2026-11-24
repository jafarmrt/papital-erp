import { describe, expect, it } from 'vitest';
import {
  ANSWER_LONG_MAX, ANSWER_SHORT_MAX, CONSENT_ACCEPTED, CONSENT_NOT_ACCEPTED, MESSAGES_HOURLY_CAP, checkedAnswers, firstAnswer, messagePreview, messagesWarnAt,
} from '../../lib/storefront/storefrontMessageRules';
import type { FormField } from '../../lib/storefront/storefrontFormRules';
import { FORM_STAMP, formStampOf } from '../../services/storefront/storefrontFormStamp';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): how a visitor's answers are checked against a
 * form: each kind takes its own shape, an answer to a field the form does not have is refused, and what is kept is
 * plain text under each field's name.
 */
const field = (id: string, kind: FormField['kind'], over: Partial<FormField> = {}): FormField => ({ id, kind, label: `فیلد ${id}`, required: false, help: '', options: [], ...over });
const FORM = {
  fields: [
    field('f1', 'shortText', { label: 'نام', required: true }), field('f2', 'mobile'), field('f3', 'email'), field('f4', 'number'),
    field('f5', 'choice', { options: ['الف', 'ب'] }), field('f6', 'choices', { options: ['یک', 'دو', 'سه'] }), field('f7', 'date'), field('f8', 'longText'), field('f9', 'consent', { label: 'می‌پذیرم' }),
  ],
};
const valuesOf = (raw: unknown) => checkedAnswers(FORM, raw).answers?.map(answer => answer.value);
const problemOf = (raw: unknown) => checkedAnswers(FORM, raw).problem;

describe('the answers of a visitor to a form of the site', () => {
  it('keeps each answer in its field\'s own shape', () => {
    expect(valuesOf({ f1: '  علی   رضایی ', f2: '+98 912 345 6789', f3: 'A.b@Example.IR', f4: '۱۲٫۵', f5: 'ب', f6: ['سه', 'یک', 'سه'], f7: '1405/09/03', f8: ' یک \n\n\n\n دو\tسه ', f9: true }))
      .toEqual(['علی رضایی', '09123456789', 'A.b@example.ir', '12.5', 'ب', 'یک\nسه', '2026-11-24', 'یک\n\nدو سه', CONSENT_ACCEPTED]);
    // a form sent without a script names a tick «on» and one choice of several as a text
    expect(valuesOf({ f1: 'نام', f6: 'دو', f9: 'on' })).toEqual(['نام', '', '', '', '', 'دو', '', '', CONSENT_ACCEPTED]);
    expect(valuesOf({ f1: 'نام' })?.[8]).toBe(CONSENT_NOT_ACCEPTED);
    expect(checkedAnswers(FORM, { f1: 'نام' }).answers?.[0]).toEqual({ label: 'نام', kind: 'shortText', value: 'نام' });
  });

  it('takes markup as the plain text it is', () => {
    expect(valuesOf({ f1: '<b>نام</b>', f8: '<script>alert(1)</script>' })).toEqual(['<b>نام</b>', '', '', '', '', '', '', '<script>alert(1)</script>', CONSENT_NOT_ACCEPTED]);
  });

  it('refuses an answer of another shape, naming its field', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ f1: 'نام', f2: '0912' }, 'f2'], [{ f1: 'نام', f2: '02112345678' }, 'f2'], [{ f1: 'نام', f3: 'a@b' }, 'f3'], [{ f1: 'نام', f3: 'a b@c.ir' }, 'f3'],
      [{ f1: 'نام', f4: 'ده' }, 'f4'], [{ f1: 'نام', f4: '1'.repeat(16) }, 'f4'], [{ f1: 'نام', f4: '1.2.3' }, 'f4'], [{ f1: 'نام', f5: 'ج' }, 'f5'], [{ f1: 'نام', f5: ['الف'] }, 'f5'],
      [{ f1: 'نام', f6: ['یک', 'چهار'] }, 'f6'], [{ f1: 'نام', f6: [1] }, 'f6'], [{ f1: 'نام', f7: '1405/12/30' }, 'f7'], [{ f1: 'نام', f7: 'فردا' }, 'f7'],
      [{ f1: 'نام', f8: 'پ'.repeat(ANSWER_LONG_MAX + 1) }, 'f8'], [{ f1: 'ن'.repeat(ANSWER_SHORT_MAX + 1) }, 'f1'], [{ f1: 7 }, 'f1'], [{ f1: { text: 'نام' } }, 'f1'],
      [{ f1: `نام${String.fromCharCode(0x202e)}` }, 'f1'], [{ f1: `نام${String.fromCharCode(0)}` }, 'f1'], [{ f1: 'نام', f9: 'yes' }, 'f9'], [{ f1: 'نام', f9: 1 }, 'f9'],
    ];
    for (const [raw, fieldId] of cases) expect(problemOf(raw), JSON.stringify(raw).slice(0, 80)).toMatchObject({ fieldId, code: 'STOREFRONT_MESSAGE_FIELD_INVALID' });
  });

  it('asks for what the form requires, and for something written', () => {
    expect(problemOf({ f2: '09123456789' })).toMatchObject({ fieldId: 'f1', code: 'STOREFRONT_MESSAGE_FIELD_REQUIRED' });
    expect(problemOf({ f1: '   ' })).toMatchObject({ fieldId: 'f1', code: 'STOREFRONT_MESSAGE_FIELD_REQUIRED' });
    const ticked = { fields: [field('f1', 'shortText'), field('f2', 'consent', { required: true, label: 'قوانین' })] };
    expect(checkedAnswers(ticked, { f1: 'نام' }).problem).toMatchObject({ fieldId: 'f2', code: 'STOREFRONT_MESSAGE_FIELD_REQUIRED' });
    // every field optional and nothing written: no message
    expect(checkedAnswers({ fields: [field('f1', 'shortText'), field('f2', 'consent')] }, { f2: true }).problem).toMatchObject({ code: 'STOREFRONT_MESSAGE_EMPTY' });
    expect(checkedAnswers({ fields: [field('f1', 'shortText'), field('f2', 'consent')] }, {}).problem).toMatchObject({ code: 'STOREFRONT_MESSAGE_EMPTY' });
  });

  it('reads a text of nothing that can be seen as an empty answer (review of #505, L5)', () => {
    // a zero-width space and joiner, a soft hyphen, a blank of Braille and a filler of Hangul: nothing a colleague could read
    const blank = String.fromCharCode(0x200b, 0x200c, 0xad, 0x2800, 0x3164);
    expect(problemOf({ f1: blank })).toMatchObject({ fieldId: 'f1', code: 'STOREFRONT_MESSAGE_FIELD_REQUIRED' });
    expect(problemOf({ f1: ` ${blank} \n` })).toMatchObject({ fieldId: 'f1', code: 'STOREFRONT_MESSAGE_FIELD_REQUIRED' });
    const optional = { fields: [field('f1', 'shortText'), field('f2', 'longText')] };
    expect(checkedAnswers(optional, { f1: blank, f2: `${blank}\n${blank}` }).problem).toMatchObject({ code: 'STOREFRONT_MESSAGE_EMPTY' });
    expect(checkedAnswers(optional, { f1: blank, f2: 'نوشته' }).answers?.map(answer => answer.value)).toEqual(['', 'نوشته']);
    // a half-space inside a word, and a sign or a picture by itself, are written
    expect(checkedAnswers(optional, { f1: `می${String.fromCharCode(0x200c)}خواهم` }).answers?.[0].value).toBe(`می${String.fromCharCode(0x200c)}خواهم`);
    expect(checkedAnswers(optional, { f1: '؟' }).problem).toBeNull();
    expect(checkedAnswers(optional, { f1: String.fromCodePoint(0x1f44d) }).problem).toBeNull();
  });

  it('refuses an answer to a field the form does not have, and anything that is not a set of answers', () => {
    expect(problemOf({ f1: 'نام', f99: 'x' })).toMatchObject({ code: 'STOREFRONT_MESSAGE_FORM_CHANGED' });
    expect(problemOf(JSON.parse('{"f1":"نام","__proto__":"x"}'))).toMatchObject({ code: 'STOREFRONT_MESSAGE_FORM_CHANGED' });
    for (const raw of [null, 'f1=نام', ['نام'], 5]) expect(problemOf(raw), String(raw)).toMatchObject({ code: 'STOREFRONT_MESSAGE_INVALID' });
    // a name every object has is no answer to a field called so
    const odd = { fields: [field('constructor', 'shortText'), field('f1', 'shortText')] };
    expect(checkedAnswers(odd, { f1: 'نام' }).answers?.map(answer => answer.value)).toEqual(['', 'نام']);
  });

  it('finds the name and the phone a sales lead is opened with, and a line for the list', () => {
    const answers = checkedAnswers(FORM, { f1: 'علی رضایی', f2: '09123456789', f8: 'سلام\nمی‌خواهم سفارش بدهم', f9: true }).answers ?? [];
    expect(firstAnswer(answers, 'shortText')).toBe('علی رضایی');
    expect(firstAnswer(answers, 'mobile')).toBe('09123456789');
    expect(firstAnswer(answers, 'email')).toBe('');
    expect(messagePreview(answers)).toBe('علی رضایی · 09123456789 · سلام می‌خواهم سفارش بدهم');
    expect(messagePreview(answers, 12)).toBe('علی رضایی ·…');
  });

  it('warns at four fifths of the hour\'s cap', () => {
    expect(messagesWarnAt(MESSAGES_HOURLY_CAP)).toBe(48);
    expect(messagesWarnAt(1)).toBe(1);
  });
});

describe('the stamp of a form a visitor fills in (review of #505, M1 and L2)', () => {
  const row = { createdAt: '2026-11-24 08:00:00.123456+00', key: 'contact', title: 'تماس با ما', fields: FORM.fields };
  const stamp = formStampOf(row);

  it('is a short fixed-length word that says nothing by itself', () => {
    expect(stamp).toMatch(FORM_STAMP);
    expect(formStampOf({ ...row })).toBe(stamp);
    // the same moment written in another time zone is the same form
    expect(formStampOf({ ...row, createdAt: '2026-11-24T11:30:00.123+03:30' })).toBe(stamp);
  });

  it('changes with the form itself and with whatever gives an answer its meaning', () => {
    const changed = [
      { ...row, createdAt: '2026-11-24 08:00:01.123456+00' }, { ...row, key: 'contact-2' }, { ...row, title: 'تماس' },
      { ...row, fields: FORM.fields.slice(1) }, { ...row, fields: [...FORM.fields.slice(1), FORM.fields[0]] },
      { ...row, fields: FORM.fields.map(f => (f.id === 'f1' ? { ...f, label: 'کد تخفیف' } : f)) }, { ...row, fields: FORM.fields.map(f => (f.id === 'f1' ? { ...f, kind: 'longText' as const } : f)) },
      { ...row, fields: FORM.fields.map(f => (f.id === 'f1' ? { ...f, required: false } : f)) }, { ...row, fields: FORM.fields.map(f => (f.id === 'f5' ? { ...f, options: ['الف', 'ج'] } : f)) },
    ].map(formStampOf);
    expect(changed.filter(other => other === stamp)).toEqual([]);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('stays through a change that touches no field: a hint, the order of a field\'s own keys, anything else on the row', () => {
    expect(formStampOf({ ...row, fields: FORM.fields.map(f => ({ ...f, help: 'راهنمای تازه' })) })).toBe(stamp);
    expect(formStampOf({ ...row, fields: FORM.fields.map(f => ({ options: f.options, help: f.help, required: f.required, label: f.label, kind: f.kind, id: f.id })) })).toBe(stamp);
    expect(formStampOf({ ...row, intro: 'متن تازه', submitLabel: 'بفرست', enabled: 1, makesLead: 1, version: 9 } as typeof row)).toBe(stamp);
    // a row whose fields are no list has the stamp of a form without fields, and does not fail
    expect(formStampOf({ ...row, fields: null })).toMatch(FORM_STAMP);
  });
});
