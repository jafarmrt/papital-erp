/**
 * 10.2 package 8 (D-07): a short Persian name of a signed-in device, read from its browser's user-agent with a few
 * plain patterns (no library). It only helps a person tell their devices apart («گوشی اندروید، کروم»); it is never
 * used to decide anything, since a user-agent is whatever the browser sends.
 */

const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iphone|ipod/, 'آیفون'],
  [/ipad/, 'آیپد'],
  [/android.*mobile/, 'گوشی اندروید'],
  [/android/, 'تبلت اندروید'],
  [/windows/, 'رایانه ویندوز'],
  [/cros/, 'کروم‌بوک'],
  [/macintosh|mac os x/, 'رایانه مک'],
  [/linux/, 'رایانه لینوکس'],
];

// order matters: Edge, Opera and Samsung say «chrome» too, and Chrome says «safari»
const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/edg(e|a|ios)?\//, 'اج'],
  [/opr\/|opera/, 'اپرا'],
  [/samsungbrowser/, 'مرورگر سامسونگ'],
  [/firefox|fxios/, 'فایرفاکس'],
  [/chrome|crios|chromium/, 'کروم'],
  [/safari/, 'سافاری'],
];

export const UNKNOWN_DEVICE_LABEL = 'دستگاه ناشناس';

/** «<device>، <browser>», either part left out when not recognised, and «دستگاه ناشناس» when neither is */
export function deviceLabelOf(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua.trim()) return UNKNOWN_DEVICE_LABEL;
  const os = OS_PATTERNS.find(([pattern]) => pattern.test(ua))?.[1];
  const browser = BROWSER_PATTERNS.find(([pattern]) => pattern.test(ua))?.[1];
  const parts = [os, browser].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('، ') : UNKNOWN_DEVICE_LABEL;
}

/** a user-agent kept with a session is cut to this many characters */
export const SESSION_USER_AGENT_MAX = 400;
