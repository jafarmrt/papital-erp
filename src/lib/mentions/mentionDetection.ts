/**
 * v9.0.232 (TD-628, finding B13-03): which users a text mentions with «@name».
 *
 * Each «@» is matched with the LONGEST display name or username that follows it and ends at a word boundary, so
 * «@علی رضایی» mentions «علی رضایی» only, never «علی» as well, and «@علی‌رضا» does not mention «علی». Shared by the
 * daily work log form and the sales follow-up form (`MentionTextarea`).
 */
export interface MentionCandidate {
  id: number;
  fullName?: string;
  full_name?: string;
  username: string;
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_‌]/u;

export function mentionDisplayName(u: MentionCandidate): string {
  if (!u) return '';
  return (u.fullName || u.full_name || u.username || '').trim();
}

/** The mentioned user ids, in order of first appearance and without duplicates */
export function detectMentionedUserIds(text: string, users: MentionCandidate[]): number[] {
  const names: Array<{ id: number; name: string }> = [];
  for (const u of users) {
    for (const name of new Set([mentionDisplayName(u), (u.username || '').trim()])) {
      if (name) names.push({ id: u.id, name });
    }
  }
  names.sort((a, b) => b.name.length - a.name.length);

  const found: number[] = [];
  let at = text.indexOf('@');
  while (at !== -1) {
    const rest = text.slice(at + 1);
    const match = names.find(({ name }) => rest.startsWith(name) && !WORD_CHAR.test(rest.charAt(name.length)));
    if (match && !found.includes(match.id)) found.push(match.id);
    at = text.indexOf('@', at + 1);
  }
  return found;
}

/** Whether two id lists hold the same ids (order ignored) */
export function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(id => set.has(id));
}
