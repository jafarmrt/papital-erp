import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, mediaAssets } from '../../db/schema.js';
import { isSecretsKeyConfigured } from '../../lib/secretBox.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { chunked } from '../../lib/woocommerce/wcCatalog.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';
import {
  checkMediaBaseUrl, isMediaSendOn, WC_IMAGE_BATCH_SIZE, WC_IMAGE_MAX_PRODUCTS, WC_IMAGE_PUSH_SETTING_KEY, WC_MEDIA_BASE_URL_SETTING_KEY,
} from '../../lib/woocommerce/wcMediaPush.js';
import { requireWcConnection, wcRequest, type WcConnection } from './wcClient.js';
import { liveLinks, type WcActor } from './wcCatalog.service.js';
import {
  outcomeOf, runField, sendAndRecord, writeSetting, type FieldRunOptions, type FieldRunOutcome, type Planned,
} from './wcFieldPush.service.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';
import { ValidationError } from '../../errors/customErrors.js';
import { updateLinkRows } from './wcLinkUpdates.js';
import { signedImageUrl } from './wcShopImageLink.js';

/**
 * v11 phase 6.5 (D-04 part D, decisions ت۴۵ / ت۴۶): «ارسال تصویر شاخص». Each live link keeps the SHA-256 of the cover it
 * last brought in line (`cover_sent_sha256`: '' never compared, 'none' compared while the item had no cover) and the shop's
 * image id as last read or written (`site_image_id`: 0 none, null not read yet). On the first comparison a product that has
 * an image in the shop only takes the item's cover as its baseline and nothing is sent; one without an image gets the
 * cover. Afterwards only a changed cover is sent; a cover taken away is recorded and removes nothing from the shop. A send
 * reads the product's images again first and keeps its gallery (`images: [{ src }, …gallery by id]`); a variation gets
 * `image: { src }`. The shop downloads the file inside the batch request, so batches are of `WC_IMAGE_BATCH_SIZE` and a run
 * sends at most `WC_IMAGE_MAX_PRODUCTS`; the new image id comes back on the answer row.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

/** what the image push does with one link: send the cover, only record what it compared, or nothing */
export type ImageStep = { send: true } | { record: string } | null;

export function imageStep(link: { siteImageId: number | null; coverSentSha256: string }, cover: string | null): ImageStep {
  const sent = link.coverSentSha256;
  if (sent === '') {
    if (link.siteImageId === null) return null;
    if (link.siteImageId > 0 || cover === null) return { record: cover ?? 'none' };
    return { send: true };
  }
  if (cover === null) return sent === 'none' ? null : { record: 'none' };
  return cover === sent ? null : { send: true };
}

async function setting(key: string): Promise<string> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return String(row?.value ?? '').trim();
}

export async function imagePushSettings(): Promise<{ enabled: boolean; baseUrl: string; secretsReady: boolean }> {
  const [on, baseUrl] = await Promise.all([setting(WC_IMAGE_PUSH_SETTING_KEY), setting(WC_MEDIA_BASE_URL_SETTING_KEY)]);
  return { enabled: isMediaSendOn(on), baseUrl, secretsReady: isSecretsKeyConfigured() };
}

/** The live covers (with a light version) of these items */
export async function coversOf(itemIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const part of chunked([...new Set(itemIds)], 5000)) {
    const rows = await orm.select({ itemId: mediaAssets.itemId, sha256: mediaAssets.sha256, lightBytes: mediaAssets.lightBytes }).from(mediaAssets)
      .where(and(inArray(mediaAssets.itemId, part), eq(mediaAssets.isCover, 1), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image')));
    for (const r of rows) if (r.itemId !== null && r.lightBytes !== null) out.set(r.itemId, r.sha256);
  }
  return out;
}

/** The links and what the image push does with each */
export async function imageSteps(): Promise<Array<{ link: Link; cover: string | null; step: ImageStep }>> {
  const links = (await liveLinks()).filter(l => l.imageFailureCount < WC_AUTO_MAX_LINK_FAILURES);
  const covers = await coversOf(links.map(l => l.itemId));
  return links.map(link => {
    const cover = covers.get(link.itemId) ?? null;
    return { link, cover, step: imageStep(link, cover) };
  });
}

interface ShopImage { id?: unknown }

/** The images each of these shop products holds now, read again just before the send so the gallery is kept */
async function currentImages(conn: WcConnection, productIds: number[], signal: AbortSignal): Promise<Map<number, ShopImage[]>> {
  const out = new Map<number, ShopImage[]>();
  for (const part of chunked(productIds, 100)) {
    const answer = await wcRequest(conn, 'GET', 'products', null, {
      include: part.join(','), per_page: part.length, status: 'any', _fields: 'id,images',
    }, { signal });
    for (const row of Array.isArray(answer) ? answer as Array<{ id?: unknown; images?: unknown }> : []) {
      out.set(Number(row.id), Array.isArray(row.images) ? row.images as ShopImage[] : []);
    }
  }
  return out;
}

/** The shop image id an answer row carries (a product's first image, a variation's own image), else null */
export function answeredImageId(answer: Record<string, unknown> | undefined, variation: boolean): number | null {
  const image = variation ? answer?.image : Array.isArray(answer?.images) ? (answer.images as unknown[])[0] : undefined;
  const id = Number((image as ShopImage | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const GONE = 'محصول در سایت پیدا نشد؛ «بازخوانی محصولات سایت» را بزنید.';

/** One automatic image run */
export function runImagePushOnce(now: Date = new Date(), options: FieldRunOptions = {}): Promise<FieldRunOutcome> {
  const enabled = async () => {
    const s = await imagePushSettings();
    return s.enabled && s.baseUrl !== '' && s.secretsReady;
  };
  return runField('image_push', enabled, now, async (signal) => {
    const { baseUrl } = await imagePushSettings();
    const steps = await imageSteps();
    // the baselines and the covers taken away are recorded without asking the shop
    const recorded = steps.flatMap(s => (s.step && 'record' in s.step ? [{ id: s.link.id, values: { coverSentSha256: s.step.record } }] : []));
    if (recorded.length > 0) await orm.transaction(tx => updateLinkRows(tx, recorded, systemNowUtcIso()));
    const due = steps.filter(s => s.step && 'send' in s.step && s.cover !== null)
      .slice(0, options.maxProducts ?? WC_IMAGE_MAX_PRODUCTS) as Array<{ link: Link; cover: string }>;
    if (due.length === 0) return { state: 'nothing' };
    const conn = await requireWcConnection();
    const gallery = await currentImages(conn, due.filter(d => d.link.wcVariationId === 0).map(d => d.link.wcProductId), signal);
    const plan: Planned[] = [];
    const gone: Planned[] = [];
    for (const { link, cover } of due) {
      const src = signedImageUrl(baseUrl, link.id, cover, now.getTime());
      if (!src) return { state: 'off' };
      const values = { coverSentSha256: cover, imageError: '', imageFailureCount: 0 };
      if (link.wcVariationId > 0) {
        plan.push({ link, fields: { image: { src } }, values });
        continue;
      }
      const images = gallery.get(link.wcProductId);
      if (!images) {
        gone.push({ link, fields: {}, values });
        continue;
      }
      const kept = images.slice(1).map(i => Number(i.id)).filter(id => Number.isInteger(id) && id > 0).map(id => ({ id }));
      plan.push({ link, fields: { images: [{ src }, ...kept] }, values });
    }
    return outcomeOf(await sendAndRecord('image_push', plan, steps.length, {}, signal, {
      batchSize: WC_IMAGE_BATCH_SIZE,
      refused: gone.map(g => ({ link: g.link, error: GONE })),
      answered: (link, answer) => {
        const id = answeredImageId(answer, link.wcVariationId > 0);
        return id === null ? {} : { siteImageId: id };
      },
    }));
  });
}

export const WC_IMAGE_PUSH_NEEDS_SECRETS_KEY = 'WC_IMAGE_PUSH_NEEDS_SECRETS_KEY';
export const WC_MEDIA_BASE_URL_INVALID = 'WC_MEDIA_BASE_URL_INVALID';

/**
 * «ارسال تصویر شاخص» (`POST /woocommerce/image-push` with the target state): turning it on needs the program's public
 * address, which WordPress can download from (http or https, port 80, 443 or 8080, not an internal address), and
 * `ERP_SECRETS_KEY` to sign the addresses; turning it off keeps the stored address
 */
export async function setImagePush(actor: WcActor, enabled: boolean, mediaBaseUrl?: string): Promise<{ enabled: boolean; changed: boolean; baseUrl: string }> {
  let baseUrl = (await imagePushSettings()).baseUrl;
  let urlChanged = false;
  if (enabled) {
    if (!isSecretsKeyConfigured()) {
      throw new ValidationError('کلید رمزنگاری سرور (ERP_SECRETS_KEY) تنظیم نشده و پیوند امضاشدهٔ تصویر ساخته نمی‌شود؛ مدیر سامانه باید آن را تنظیم کند.', undefined, WC_IMAGE_PUSH_NEEDS_SECRETS_KEY);
    }
    const checked = checkMediaBaseUrl(mediaBaseUrl ?? baseUrl);
    if ('error' in checked) throw new ValidationError(checked.error, undefined, WC_MEDIA_BASE_URL_INVALID);
    try {
      // the port was checked above (WordPress downloads from 8080 too, which the program itself never calls out to), so only
      // the host goes through the address guard
      const host = new URL(checked.url);
      host.port = '';
      await assertSafeExternalUrl(host.origin, { allowLocalEcho: false });
    } catch {
      throw new ValidationError('نشانی عمومی برنامه داخلی است یا پیدا نشد؛ سایت فقط از نشانی عمومی اینترنتی تصویر برمی‌دارد.', undefined, WC_MEDIA_BASE_URL_INVALID);
    }
    urlChanged = await writeSetting(actor, WC_MEDIA_BASE_URL_SETTING_KEY, checked.url, before => ({
      text: `نشانی عمومی برنامه برای تصویرهای سایت «${checked.url}» شد`, before: { mediaBaseUrl: before }, after: { mediaBaseUrl: checked.url },
    }));
    baseUrl = checked.url;
  }
  const changed = await writeSetting(actor, WC_IMAGE_PUSH_SETTING_KEY, enabled ? '1' : '0', before => ({
    text: enabled ? 'ارسال تصویر شاخص به سایت روشن شد' : 'ارسال تصویر شاخص به سایت خاموش شد',
    before: { enabled: isMediaSendOn(before) }, after: { enabled },
  }));
  return { enabled, changed: changed || urlChanged, baseUrl };
}
