import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { siteEnv } from './site.server';

/**
 * v12 phase 8a (site review 2.12): a simple trap for robots on the forms that make something in the ERP (the corporate
 * gift lead, the wholesale request, a new account). Checked here, on the site's own server, so a trapped form never
 * reaches the ERP. Two signs of a robot:
 *
 * - The hidden field `contact_website` is filled. People never see it (it is clipped to nothing, out of the tab order and
 *   hidden from screen readers); a robot that fills every field fills it too.
 * - The form came back too fast. The page carries `formAt`, the time it was made and this server's signature of it, so
 *   a robot can neither leave it out nor write an older time; a form sent sooner than `STOREFRONT_FORM_MIN_SECONDS`
 *   (3 by default) after the page was made is refused, and so is one older than a day (the page was left open: a fresh
 *   one is a click away).
 *
 * A trapped form gets a plain sentence, never a fake «sent»: a person who tripped it by accident knows to send again.
 * It is a simple trap (the start plan): a stamp is not tied to one form or one use, so a robot that reads a page and
 * waits passes it for a day; the ERP's own limits per address and per phone stay in front of every one of these forms.
 */
export const TRAP_FIELD = 'contact_website';
export const STAMP_FIELD = 'formAt';
const MAX_AGE_MS = 24 * 3600 * 1000;
const STAMP = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

/** the server's signing key: from the site's API key, else a fresh one per process (pages from before a restart then expire) */
let fallbackKey: Buffer | null = null;
function signingKey(): Buffer {
  const apiKey = siteEnv().apiKey;
  if (apiKey) return createHash('sha256').update(`storefront-bot-trap|${apiKey}`).digest();
  fallbackKey ??= randomBytes(32);
  return fallbackKey;
}

const signatureOf = (key: Buffer, at: string) => createHmac('sha256', key).update(at).digest('base64url');

/** an unset or empty setting is the default 3 seconds, never 0 */
const minimumMs = () => {
  const raw = (process.env.STOREFRONT_FORM_MIN_SECONDS ?? '').trim();
  const seconds = raw === '' ? 3 : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 3000;
};

/** the stamp's time when it is this server's own, else null (the signature compared in constant time) */
function genuineAt(sent: string, key: Buffer): number | null {
  const stamp = STAMP.exec(sent);
  if (!stamp) return null;
  const [, at, signature] = stamp;
  const expected = Buffer.from(signatureOf(key, at));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? Number(at) : null;
}

/** the stamp a page puts in its form when it is made */
export function formStamp(now = Date.now(), key = signingKey()): string {
  const at = String(now);
  return `${at}.${signatureOf(key, at)}`;
}

export const TRAP_REFUSED = 'فرستادن این فرم پذیرفته نشد؛ چند ثانیه صبر کنید و دوباره بفرستید.';
export const STAMP_EXPIRED = 'این صفحه کهنه شده است؛ صفحه را تازه کنید و دوباره بفرستید.';

/**
 * Why a posted form looks like a robot's, or null when it looks like a person's. `now`, `key` and `minMs` are given only
 * by the tests.
 */
export function trapRefusal(form: FormData, now = Date.now(), key = signingKey(), minMs = minimumMs()): string | null {
  if (String(form.get(TRAP_FIELD) ?? '') !== '') return TRAP_REFUSED;
  const at = genuineAt(String(form.get(STAMP_FIELD) ?? ''), key);
  if (at === null) return STAMP_EXPIRED;
  const age = now - at;
  if (age > MAX_AGE_MS || age < -60_000) return STAMP_EXPIRED;
  if (age < minMs) return TRAP_REFUSED;
  return null;
}

/**
 * The stamp to render again after a form came back with an error, so fixing one field and sending again is never «too
 * fast»: the one sent while it is genuine and under a day old, else a fresh one
 */
export function keptStamp(form: FormData, now = Date.now(), key = signingKey()): string {
  const sent = String(form.get(STAMP_FIELD) ?? '');
  const at = genuineAt(sent, key);
  return at !== null && now - at <= MAX_AGE_MS ? sent : formStamp(now, key);
}
