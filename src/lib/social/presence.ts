/**
 * v10.2 package 9 (group dashboard, part D): «برخط است» and «امروز آمده». The system is one process (AGENTS §22), so the
 * last request time of each user is kept in memory only, written by `authenticateToken` after it knows the user; nothing
 * is stored and nothing says which page a user is on. A restart forgets it.
 */
/** The name shown for a user without a full name (review N-5), never their login name */
export const COLLEAGUE_FALLBACK_NAME = 'همکار';

export const PRESENCE_ONLINE_MS = 5 * 60 * 1000;

/**
 * Review N-5: the browser's background polls (bell count, presence, inbox counts, event monitors) carry this header and
 * do not count as presence, so a tab left open does not keep its user «برخط».
 */
export const BACKGROUND_POLL_HEADER = 'X-ERP-Background';
export const BACKGROUND_POLL_HEADERS: Readonly<Record<string, string>> = { [BACKGROUND_POLL_HEADER]: '1' };
/** Whether a request (its lower-cased header value) is a background poll */
export const isBackgroundPoll = (headerValue: string | string[] | undefined) => (Array.isArray(headerValue) ? headerValue[0] : headerValue) === '1';
export type PresenceStatus = 'online' | 'today';

const lastSeen = new Map<number, number>();

export function recordPresence(userId: number, nowMs = Date.now(), seen: Map<number, number> = lastSeen): void {
  if (Number.isSafeInteger(userId) && userId > 0) seen.set(userId, nowMs);
}

export function lastSeenOf(userId: number, seen: Map<number, number> = lastSeen): number | undefined {
  return seen.get(userId);
}

/** Online within the last five minutes, else «today» when seen on the business day `todayIso` (in `timeZone`) */
export function presenceStatus(lastSeenMs: number | undefined, nowMs: number, todayIso: string, timeZone: string): PresenceStatus | null {
  if (lastSeenMs === undefined) return null;
  if (nowMs - lastSeenMs <= PRESENCE_ONLINE_MS && lastSeenMs <= nowMs + 60_000) return 'online';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(lastSeenMs));
  return day === todayIso ? 'today' : null;
}

/** One colleague on the card (`GET /social/presence`) */
export interface PresenceColleague {
  userId: number;
  name: string;
  avatarUrl: string;
  status: PresenceStatus;
}

export const PRESENCE_LABELS: Readonly<Record<PresenceStatus, string>> = {
  online: 'برخط است',
  today: 'امروز آمده',
};

/** The user's own choices (`GET` / `PUT /social/preferences`); `showBirthday` is null without a linked personnel */
export interface SocialPreferences {
  showBirthday: boolean | null;
  showPresence: boolean;
}

/** «تازه‌های این نسخه» (`GET /social/whats-new`); null when the current version has no entry */
export interface WhatsNewAnswer {
  version: string;
  title: string;
  lines: string[];
  dismissed: boolean;
}
