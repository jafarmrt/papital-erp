import { toLatinDigits } from '../numericInput.js';
import { toStorageDate } from '../../utils/calendarDate.js';
import { normalizeEmail } from './storefrontEmailRules.js';
import { normalizeMobile } from './storefrontOrderRules.js';
import { hasLoneSurrogate, isRecord } from './storefrontPageParts.js';
import { isWritten, type FormField, type FormFieldKind, type FormValues } from './storefrontFormRules.js';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): the rules of «پیام‌های سایت», shared by the server
 * and the screen (no I/O). A visitor's answers are checked against the form as it is now, field by field: an answer to
 * a field the form does not have is refused, each kind takes only its own shape, and every answer is kept as plain
 * text. What is kept is a copy: each answer with the field's name and kind at that moment.
 */
export const MESSAGE_STATUSES = ['new', 'seen', 'answered'] as const;
export type MessageStatus = typeof MESSAGE_STATUSES[number];
export const MESSAGE_STATUS_TITLES: Readonly<Record<MessageStatus, string>> = { new: 'تازه', seen: 'دیده‌شده', answered: 'پاسخ داده شد' };
export const isMessageStatus = (value: unknown): value is MessageStatus => (MESSAGE_STATUSES as readonly unknown[]).includes(value);

export const ANSWER_SHORT_MAX = 200;
export const ANSWER_LONG_MAX = 2000;
export const ANSWER_NUMBER_DIGITS = 15;
export const MESSAGES_PAGE_SIZE = 30;
/** the messages the whole site may send in an hour; at `MESSAGES_WARN_PERCENT` of it the colleagues get a bell */
export const MESSAGES_HOURLY_CAP = 60;
export const MESSAGES_WARN_PERCENT = 80;
/**
 * The messages one visitor address may send in an hour (review of #505, M2): well under the site's cap, so one address
 * cannot fill the hour for every visitor. A shared address (a mobile network) shares this number.
 */
export const MESSAGES_PER_VISITOR_HOUR = 10;
/** the sends, taken or refused, one visitor address may try in a minute: a count of its own, apart from sign-in's */
export const MESSAGE_TRIES_PER_MINUTE = 20;
export const messagesWarnAt = (cap: number): number => Math.max(1, Math.ceil(cap * MESSAGES_WARN_PERCENT / 100));
export const MESSAGE_REQUEST_KEY = /^[A-Za-z0-9_-]{16,80}$/;
/** what a tick of acceptance is kept as */
export const CONSENT_ACCEPTED = 'پذیرفته شد';
export const CONSENT_NOT_ACCEPTED = 'پذیرفته نشد';

/** One answer as it is kept: the field's name and kind when the message arrived, and what was written (plain text; several choices on a line each) */
export interface MessageAnswer {
  label: string;
  kind: FormFieldKind;
  value: string;
}
export interface AnswerProblem { /** the form's field the problem is in ('' = the request itself) */ fieldId: string; message: string; code: string }
export type CheckedAnswers = { answers: MessageAnswer[]; problem: null } | { answers: null; problem: AnswerProblem };

// a control character other than the line break, and the characters that turn the direction of a line over
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const lines = (value: string): string => value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const fa = (n: number) => n.toLocaleString('fa-IR');

/** What one field takes from what was sent for it: its kept text ('' = left empty), or the reason it is refused */
function answerOf(field: FormField, raw: unknown): { value: string } | { message: string } {
  const name = `«${field.label}»`;
  if (field.kind === 'consent') {
    if (raw !== undefined && raw !== null && typeof raw !== 'boolean' && raw !== 'on' && raw !== '') return { message: `${name} را فقط می‌شود تیک زد یا نزد.` };
    return { value: raw === true || raw === 'on' ? CONSENT_ACCEPTED : '' };
  }
  if (field.kind === 'choices') {
    const picked = raw === undefined || raw === null || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];
    if (picked.some(option => typeof option !== 'string' || !field.options.includes(option))) return { message: `یکی از گزینه‌های ${name} شناخته نیست.` };
    // in the form's own order, each once
    return { value: field.options.filter(option => picked.includes(option)).join('\n') };
  }
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { message: `پاسخ ${name} باید متن باشد.` };
  const text = String(raw ?? '');
  // a tab and a carriage return are read as spaces and line breaks; any other control character is refused
  if (UNSAFE.test(text.replace(/[\r\t]/g, ' ')) || hasLoneSurrogate(text)) return { message: `پاسخ ${name} متن ساده است؛ نویسهٔ پنهان یا ناقص در آن نمی‌آید.` };
  switch (field.kind) {
    case 'longText': {
      // a text of nothing that can be seen (zero-width marks, a blank of another script) is an empty answer
      const value = isWritten(lines(text)) ? lines(text) : '';
      return value.length > ANSWER_LONG_MAX ? { message: `پاسخ ${name} حداکثر ${fa(ANSWER_LONG_MAX)} نویسه است.` } : { value };
    }
    case 'mobile': {
      const value = oneLine(text);
      if (!value) return { value };
      const mobile = normalizeMobile(value);
      return mobile ? { value: mobile } : { message: `${name} را مانند ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.` };
    }
    case 'email': {
      const value = oneLine(text);
      if (!value) return { value };
      const email = normalizeEmail(value);
      return email ? { value: email } : { message: `${name} نشانی ایمیل درستی نیست.` };
    }
    case 'number': {
      const value = toLatinDigits(oneLine(text)).replace(/[٬,\s]/g, '').replace('٫', '.');
      if (!value) return { value };
      const shape = /^-?\d+(\.\d+)?$/.test(value) && value.replace(/\D/g, '').length <= ANSWER_NUMBER_DIGITS;
      return shape ? { value } : { message: `${name} را فقط با رقم بنویسید.` };
    }
    case 'date': {
      const value = toStorageDate(oneLine(text));
      return value === null ? { message: `${name} را مانند ۱۴۰۵/۱۰/۱۵ بنویسید.` } : { value };
    }
    case 'choice': {
      const value = text;
      if (!value) return { value };
      return field.options.includes(value) ? { value } : { message: `گزینهٔ ${name} شناخته نیست.` };
    }
    default: {
      const value = isWritten(oneLine(text)) ? oneLine(text) : '';
      return value.length > ANSWER_SHORT_MAX ? { message: `پاسخ ${name} حداکثر ${fa(ANSWER_SHORT_MAX)} نویسه است.` } : { value };
    }
  }
}

/**
 * A visitor's answers to a form (`{ fieldId: answer }`), as they are kept, or the first reason they are refused. An
 * answer to a field the form does not have is refused (a form changed while the visitor was writing is sent again from
 * the form as it is now), and so is a form sent with nothing in it.
 */
export function checkedAnswers(form: Pick<FormValues, 'fields'>, raw: unknown): CheckedAnswers {
  const refuse = (fieldId: string, message: string, code = 'STOREFRONT_MESSAGE_FIELD_INVALID'): CheckedAnswers => ({ answers: null, problem: { fieldId, message, code } });
  if (!isRecord(raw)) return refuse('', 'پاسخ‌های فرم خوانا نیست.', 'STOREFRONT_MESSAGE_INVALID');
  const known = new Set(form.fields.map(field => field.id));
  // own keys alone, so nothing an object carries from elsewhere is read as an answer
  const unknown = Object.keys(raw).find(key => !known.has(key));
  if (unknown !== undefined) return refuse('', 'این فرم عوض شده است؛ صفحه را دوباره باز کنید و فرم را از نو پر کنید.', 'STOREFRONT_MESSAGE_FORM_CHANGED');
  const answers: MessageAnswer[] = [];
  for (const field of form.fields) {
    const given = Object.prototype.hasOwnProperty.call(raw, field.id) ? raw[field.id] : undefined;
    const taken = answerOf(field, given);
    if ('message' in taken) return refuse(field.id, taken.message);
    if (field.required && taken.value === '') {
      return refuse(field.id, field.kind === 'consent' ? `برای فرستادن فرم، «${field.label}» را تیک بزنید.` : `«${field.label}» را پر کنید.`, 'STOREFRONT_MESSAGE_FIELD_REQUIRED');
    }
    answers.push({ label: field.label, kind: field.kind, value: field.kind === 'consent' && taken.value === '' ? CONSENT_NOT_ACCEPTED : taken.value });
  }
  // a form sent with nothing written in it (only ticks, or all its optional fields left empty) is no message
  if (!answers.some(answer => answer.kind !== 'consent' && answer.value !== '')) return refuse('', 'فرم خالی است؛ دست‌کم یک فیلد را پر کنید.', 'STOREFRONT_MESSAGE_EMPTY');
  return { answers, problem: null };
}

/** The first answer of one kind that is filled in ('' = none): the name and the phone a sales lead is opened with */
export const firstAnswer = (answers: readonly MessageAnswer[], kind: FormFieldKind): string => answers.find(answer => answer.kind === kind && answer.value !== '')?.value ?? '';

/** A line of a list for one message: its first answers that are written, on one line */
export function messagePreview(answers: readonly MessageAnswer[], max = 140): string {
  const text = answers.filter(answer => answer.kind !== 'consent' && answer.value !== '').map(answer => answer.value.replace(/\s+/g, ' ')).join(' · ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
