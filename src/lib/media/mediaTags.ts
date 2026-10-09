/**
 * v10.0.27 (N-05 PR 3): the tags of a media library file. Shared by the server (`PUT /media/assets/:id`) and the browser
 * edit form, so both read a tag list the same way; migration 0098 holds the same count limit as a CHECK constraint.
 */
export const MEDIA_TAG_LIMITS = {
  tags: 20,
  tagLength: 40,
} as const;

export const MEDIA_TAG_TEXT = {
  tooMany: 'حداکثر ۲۰ برچسب برای هر فایل پذیرفته است.',
  tooLong: 'هر برچسب حداکثر ۴۰ نویسه است.',
} as const;

export type MediaTagResult = { ok: true; value: string[] } | { ok: false; error: string };

/**
 * A tag list: an array, or text separated by «،», «,», «;» or a new line. Each tag is trimmed with its inner spaces folded
 * and a leading «#» dropped; empty and repeated tags (letter case ignored) are dropped.
 */
export function normalizeMediaTags(input: unknown): MediaTagResult {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[،,;\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const tag = String(entry ?? '').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
    if (!tag) continue;
    if (tag.length > MEDIA_TAG_LIMITS.tagLength) return { ok: false, error: MEDIA_TAG_TEXT.tooLong };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > MEDIA_TAG_LIMITS.tags) return { ok: false, error: MEDIA_TAG_TEXT.tooMany };
  return { ok: true, value: out };
}
