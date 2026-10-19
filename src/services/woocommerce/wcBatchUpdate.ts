import { ValidationError } from '../../errors/customErrors.js';
import { chunked } from '../../lib/woocommerce/wcCatalog.js';
import { wcRequest, type WcConnection } from './wcClient.js';
import { isShopLevelFailure } from './wcStockPush.service.js';

/**
 * 10.2 package 6 (D-04 part C): fields of linked products sent in `products/batch` and `products/<id>/variations/batch`
 * requests of at most 100 rows, like the stock push. Each product's answer comes back on its own row: a refusal of that
 * product (`error`), or a request that failed for the shop or was never sent past the deadline (`requestFailed`), which never
 * counts against the product.
 */
export interface BatchLink { id: number; wcProductId: number; wcVariationId: number }

export interface FieldOutcome<L extends BatchLink> { link: L; error: string; requestFailed?: boolean }

interface BatchAnswerRow { id?: unknown; error?: { message?: unknown } }

const DEADLINE_MESSAGE = 'کار با سایت در مهلت تعیین‌شده تمام نشد و این محصول فرستاده نشد؛ در دور بعد فرستاده می‌شود.';

async function sendBatch<L extends BatchLink>(
  conn: WcConnection, path: string, rows: Array<{ link: L; id: number; fields: Record<string, unknown> }>, signal: AbortSignal,
): Promise<Array<FieldOutcome<L>>> {
  if (signal.aborted) return rows.map(r => ({ link: r.link, error: DEADLINE_MESSAGE, requestFailed: true }));
  try {
    const answer = await wcRequest(conn, 'POST', path, { update: rows.map(r => ({ id: r.id, ...r.fields })) }, {}, { signal });
    const list = (answer as { update?: unknown } | null)?.update;
    const byId = new Map((Array.isArray(list) ? list as BatchAnswerRow[] : []).map(a => [Number(a.id), a]));
    return rows.map(r => {
      const a = byId.get(r.id);
      if (!a) return { link: r.link, error: 'سایت پاسخی برای این محصول نداد.' };
      return { link: r.link, error: a.error ? String(a.error.message ?? 'خطای سایت').slice(0, 300) : '' };
    });
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : 'ارتباط با سایت ناموفق بود.';
    const requestFailed = isShopLevelFailure(err);
    return rows.map(r => ({ link: r.link, error: message.slice(0, 300), requestFailed }));
  }
}

/** Sends each link's fields; returns one outcome per link */
export async function sendLinkFields<L extends BatchLink>(
  conn: WcConnection, wanted: Array<{ link: L; fields: Record<string, unknown> }>, signal: AbortSignal,
): Promise<Array<FieldOutcome<L>>> {
  const simple = wanted.filter(w => w.link.wcVariationId === 0).map(w => ({ ...w, id: w.link.wcProductId }));
  const byParent = new Map<number, Array<{ link: L; fields: Record<string, unknown>; id: number }>>();
  for (const w of wanted.filter(x => x.link.wcVariationId > 0)) {
    byParent.set(w.link.wcProductId, [...(byParent.get(w.link.wcProductId) ?? []), { ...w, id: w.link.wcVariationId }]);
  }
  const outcomes: Array<FieldOutcome<L>> = [];
  for (const rows of chunked(simple)) outcomes.push(...await sendBatch(conn, 'products/batch', rows, signal));
  for (const [parent, rows] of byParent) {
    for (const part of chunked(rows)) outcomes.push(...await sendBatch(conn, `products/${parent}/variations/batch`, part, signal));
  }
  return outcomes;
}

/** As the automatic stock push: a run fails only when nothing arrived and the shop itself failed (review M-4 of part B) */
export function fieldRunStatus(outcomes: Array<{ error: string; requestFailed?: boolean }>): 'ok' | 'partial' | 'failed' {
  const failed = outcomes.filter(o => o.error).length;
  if (failed === 0) return 'ok';
  if (failed < outcomes.length) return 'partial';
  return outcomes.some(o => o.requestFailed) ? 'failed' : 'partial';
}
