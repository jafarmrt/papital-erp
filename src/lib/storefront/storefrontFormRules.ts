import { STOREFRONT_SLUG_PATTERN } from './storefrontRules.js';
import { Refused, fa, hasLoneSurrogate, isRecord, list, oneOf, onlyKeys, refuse, text } from './storefrontPageParts.js';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): the rules of «فرم‌های سایت», shared by the server
 * and the screen (no I/O). A form is a title, a few plain lines above it, up to twelve fields of nine fixed kinds, the
 * words of its button and the message shown after it is sent. Nothing in a form is markup: every text is plain text,
 * a field is rebuilt from its known keys, and anything else is refused with its message (never dropped silently).
 * A form reaches the site only while its switch «این فرم روی سایت باشد» is on.
 */
export const FORM_FIELD_KINDS = ['shortText', 'longText', 'mobile', 'email', 'number', 'choice', 'choices', 'date', 'consent'] as const;
export type FormFieldKind = typeof FORM_FIELD_KINDS[number];
export const FORM_FIELD_KIND_TITLES: Readonly<Record<FormFieldKind, string>> = {
  shortText: 'متن کوتاه', longText: 'متن بلند', mobile: 'شمارهٔ همراه', email: 'ایمیل', number: 'عدد',
  choice: 'یک انتخاب', choices: 'چند انتخاب', date: 'تاریخ', consent: 'تیک پذیرش',
};
/** the kinds whose answer is one of the form's own options */
export const hasOptions = (kind: FormFieldKind): boolean => kind === 'choice' || kind === 'choices';

export const FORMS_MAX = 50;
export const FORM_FIELDS_MAX = 12;
export const FORM_KEY_MAX = 60;
export const FORM_TITLE_MAX = 120;
export const FORM_INTRO_MAX = 1000;
export const FORM_FIELD_LABEL_MAX = 80;
/** the sentence beside a tick of acceptance is longer than a field's name */
export const FORM_CONSENT_LABEL_MAX = 300;
export const FORM_FIELD_HELP_MAX = 200;
export const FORM_OPTIONS_MIN = 2;
export const FORM_OPTIONS_MAX = 10;
export const FORM_OPTION_MAX = 60;
export const FORM_SUBMIT_LABEL_MAX = 40;
export const FORM_SUCCESS_MAX = 300;
export const FORM_SUBMIT_LABEL_DEFAULT = 'فرستادن';
export const FORM_SUCCESS_DEFAULT = 'پیام شما رسید. سپاس از شما.';
/** a field's own name inside its form, given by the screen when the field is added and never shown */
export const FORM_FIELD_ID = /^[a-z0-9]{1,12}$/;

export interface FormField {
  id: string;
  kind: FormFieldKind;
  /** the field's name above it; for a tick of acceptance, the sentence beside the tick */
  label: string;
  required: boolean;
  /** a line of guidance under the field ('' = none) */
  help: string;
  /** what may be picked, for «یک انتخاب» and «چند انتخاب» (empty for every other kind) */
  options: string[];
}
export interface FormValues {
  /** the form's Latin name in its address on the Storefront API */
  key: string;
  title: string;
  /** plain lines above the fields (a blank line starts a paragraph) */
  intro: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
}
export interface FormProblem { field: keyof FormValues; /** which field of the form (-1 = the form itself) */ index: number; message: string; code: string }
export type CheckedForm = { form: FormValues; problem: null } | { form: null; problem: FormProblem };

const FIELD_KEYS = ['id', 'kind', 'label', 'required', 'help', 'options'] as const;
// a control character other than the line break, and the characters that turn the direction of a line over
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_PARAGRAPHS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** Plain lines as they are kept: each trimmed, at most one blank line between paragraphs, none at either end */
export const formParagraphs = (value: string): string => (
  value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
);

function checkedField(raw: unknown, position: number): FormField {
  const where = `فیلد ${fa(position)}`;
  if (!isRecord(raw)) return refuse(`${where} خوانا نیست.`, 'STOREFRONT_FORM_FIELD_INVALID');
  onlyKeys(raw, FIELD_KEYS, where);
  if (typeof raw.id !== 'string' || !FORM_FIELD_ID.test(raw.id)) return refuse(`${where} خوانا نیست؛ آن را بردارید و دوباره بسازید.`, 'STOREFRONT_FORM_FIELD_INVALID');
  const kind = oneOf(raw.kind, FORM_FIELD_KINDS, `نوع ${where}`);
  const label = text(raw.label ?? '', kind === 'consent' ? FORM_CONSENT_LABEL_MAX : FORM_FIELD_LABEL_MAX, kind === 'consent' ? `جملهٔ ${where}` : `عنوان ${where}`);
  if (!label) return refuse(kind === 'consent' ? `جملهٔ کنار تیک را برای ${where} بنویسید.` : `عنوان ${where} را بنویسید.`, 'STOREFRONT_FORM_FIELD_INVALID');
  if (raw.required !== undefined && typeof raw.required !== 'boolean') return refuse(`«اجباری» ${where} خوانا نیست.`, 'STOREFRONT_FORM_FIELD_INVALID');
  const help = text(raw.help ?? '', FORM_FIELD_HELP_MAX, `راهنمای ${where}`);
  const given = raw.options === undefined ? [] : list(raw.options, FORM_OPTIONS_MAX, `گزینه‌های ${where}`);
  if (!hasOptions(kind)) {
    if (given.length > 0) return refuse(`${where} گزینه نمی‌گیرد.`, 'STOREFRONT_FORM_FIELD_INVALID');
    return { id: raw.id, kind, label, required: raw.required === true, help, options: [] };
  }
  const options = given.map((option, i) => text(option, FORM_OPTION_MAX, `گزینهٔ ${fa(i + 1)} ${where}`));
  if (options.some(option => option === '')) return refuse(`گزینهٔ خالی را از ${where} بردارید.`, 'STOREFRONT_FORM_FIELD_INVALID');
  if (options.length < FORM_OPTIONS_MIN) return refuse(`${where} دست‌کم ${fa(FORM_OPTIONS_MIN)} گزینه می‌خواهد.`, 'STOREFRONT_FORM_FIELD_INVALID');
  if (new Set(options).size !== options.length) return refuse(`دو گزینهٔ ${where} یکسان‌اند.`, 'STOREFRONT_FORM_FIELD_INVALID');
  return { id: raw.id, kind, label, required: raw.required === true, help, options };
}

/**
 * A form as it is kept, from whatever a request carried. `forSite`: the form is (or is about to be) on the site, so it
 * must have something to fill in.
 */
export function checkedForm(raw: unknown, options: { forSite: boolean }): CheckedForm {
  const problem = (field: keyof FormValues, message: string, code = 'STOREFRONT_FORM_FIELD_INVALID', index = -1): CheckedForm => ({ form: null, problem: { field, index, message, code } });
  if (!isRecord(raw)) return problem('title', 'فرم خوانا نیست.', 'STOREFRONT_FORM_INVALID');
  /** one of the form's own lines, with the form's codes */
  const line = (field: keyof FormValues, value: unknown, max: number, title: string): string | CheckedForm => {
    try {
      return text(value ?? '', max, title);
    } catch (err) {
      if (err instanceof Refused) return problem(field, err.message, err.code.replace('STOREFRONT_PAGE_', 'STOREFRONT_FORM_'));
      throw err;
    }
  };
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key || key.length > FORM_KEY_MAX || !STOREFRONT_SLUG_PATTERN.test(key)) {
    return problem('key', `نام لاتین فرم حداکثر ${fa(FORM_KEY_MAX)} نویسه است: حروف کوچک لاتین، رقم و خط تیره (مانند contact).`, 'STOREFRONT_FORM_KEY_INVALID');
  }
  const title = line('title', raw.title, FORM_TITLE_MAX, 'عنوان فرم');
  if (typeof title !== 'string') return title;
  if (!title) return problem('title', 'عنوان فرم را بنویسید.');
  if (raw.intro !== undefined && typeof raw.intro !== 'string') return problem('intro', 'متن بالای فرم باید متن باشد.');
  const intro = formParagraphs(String(raw.intro ?? ''));
  if (UNSAFE_IN_PARAGRAPHS.test(intro) || hasLoneSurrogate(intro)) return problem('intro', 'متن بالای فرم متن ساده است؛ نویسهٔ پنهان یا ناقص در آن نمی‌آید.');
  if (intro.length > FORM_INTRO_MAX) return problem('intro', `متن بالای فرم حداکثر ${fa(FORM_INTRO_MAX)} نویسه است.`, 'STOREFRONT_FORM_FIELD_TOO_LONG');
  const submitLabel = line('submitLabel', raw.submitLabel, FORM_SUBMIT_LABEL_MAX, 'نوشتهٔ دکمه');
  if (typeof submitLabel !== 'string') return submitLabel;
  const successMessage = line('successMessage', raw.successMessage, FORM_SUCCESS_MAX, 'پیام پس از فرستادن');
  if (typeof successMessage !== 'string') return successMessage;
  if (raw.fields !== undefined && !Array.isArray(raw.fields)) return problem('fields', 'فیلدهای فرم باید فهرست باشند.');
  const given = Array.isArray(raw.fields) ? raw.fields : [];
  if (given.length > FORM_FIELDS_MAX) return problem('fields', `هر فرم حداکثر ${fa(FORM_FIELDS_MAX)} فیلد می‌گیرد.`, 'STOREFRONT_FORM_TOO_MANY');
  const fields: FormField[] = [];
  for (const [index, entry] of given.entries()) {
    try {
      fields.push(checkedField(entry, index + 1));
    } catch (err) {
      if (err instanceof Refused) return problem('fields', err.message, err.code.replace('STOREFRONT_PAGE_', 'STOREFRONT_FORM_'), index);
      throw err;
    }
  }
  const twice = fields.findIndex((field, index) => fields.findIndex(other => other.id === field.id) !== index);
  if (twice >= 0) return problem('fields', `فیلد ${fa(twice + 1)} خوانا نیست؛ آن را بردارید و دوباره بسازید.`, 'STOREFRONT_FORM_FIELD_INVALID', twice);
  // two fields by one name cannot be told apart in a message
  const sameName = fields.findIndex((field, index) => fields.findIndex(other => other.label === field.label) !== index);
  if (sameName >= 0) return problem('fields', `دو فیلد عنوان «${fields[sameName].label.slice(0, 40)}» را دارند؛ یکی را عوض کنید.`, 'STOREFRONT_FORM_FIELD_INVALID', sameName);
  if (options.forSite && fields.length === 0) return problem('fields', 'فرمی که فیلد ندارد روی سایت نمی‌آید؛ دست‌کم یک فیلد بسازید.', 'STOREFRONT_FORM_EMPTY');
  // a form of ticks alone carries no message
  if (options.forSite && fields.every(field => field.kind === 'consent')) return problem('fields', 'فرم جز تیک پذیرش دست‌کم یک فیلد دیگر می‌خواهد.', 'STOREFRONT_FORM_EMPTY');
  return {
    form: { key, title, intro, fields, submitLabel: submitLabel || FORM_SUBMIT_LABEL_DEFAULT, successMessage: successMessage || FORM_SUCCESS_DEFAULT },
    problem: null,
  };
}

/** A new field's own name: the first free one of f1, f2, … */
export function nextFieldId(fields: readonly Pick<FormField, 'id'>[]): string {
  for (let n = 1; ; n++) if (!fields.some(field => field.id === `f${n}`)) return `f${n}`;
}

export const emptyField = (kind: FormFieldKind, fields: readonly Pick<FormField, 'id'>[]): FormField => ({
  id: nextFieldId(fields), kind, label: '', required: kind === 'consent', help: '', options: hasOptions(kind) ? ['', ''] : [],
});

/**
 * «فرم تماس»: the four fields of the former site's contact form (name, email, subject, message; start plan §7.1) and an
 * optional mobile number, because most answers are given by phone (§7.5, 7). The shop changes any of it afterwards.
 */
export const contactFormTemplate = (): Pick<FormValues, 'intro' | 'fields' | 'submitLabel' | 'successMessage'> => ({
  intro: 'پرسش یا پیشنهادتان را بنویسید؛ در نخستین فرصت پاسخ می‌دهیم.',
  fields: [
    { id: 'f1', kind: 'shortText', label: 'نام و نام خانوادگی', required: true, help: '', options: [] },
    { id: 'f2', kind: 'mobile', label: 'شمارهٔ همراه', required: false, help: 'برای پاسخ، شمارهٔ همراه یا ایمیل‌تان را بنویسید.', options: [] },
    { id: 'f3', kind: 'email', label: 'ایمیل', required: false, help: '', options: [] },
    { id: 'f4', kind: 'shortText', label: 'موضوع', required: false, help: '', options: [] },
    { id: 'f5', kind: 'longText', label: 'پیام', required: true, help: '', options: [] },
  ],
  submitLabel: 'فرستادن پیام', successMessage: 'پیام شما رسید. در نخستین فرصت پاسخ می‌دهیم.',
});
export const FORM_TEMPLATES = ['contact'] as const;
export type FormTemplate = typeof FORM_TEMPLATES[number];
