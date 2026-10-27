import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Harness } from '../security/workflowTestHarness.js';
import type { MockProduct } from '../fixtures/mockWooCatalogStore.js';
import { brief, newItem, withShop } from './wooCatalogTestKit.js';
import { later } from './wooShopSyncTests.js';

/**
 * v11 phase 6.5 (D-04 part D, decisions ت۴۴ to ت۴۶): «ارسال تصویر شاخص» and «ارسال کالکشن‌ها». Every case runs against the
 * stand-in shop on 127.0.0.1 and calls one run directly. Red on v11.4.0: no image or tag ever went to the shop, the routes
 * `POST /woocommerce/image-push`, `/collection-push` and `GET /woocommerce/shop-image/<file>` did not exist.
 */
const SETTING_KEYS = ['wc_image_push', 'wc_collection_push', 'wc_media_base_url'];
const PUBLIC_BASE = 'http://127.0.0.1:8080';

async function withMediaSettings<T>(h: Harness, itemIds: number[], fn: () => Promise<T>): Promise<T> {
  const previous = await h.q(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]);
  const previousDir = process.env.MEDIA_DIR;
  process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-wc-media-test-'));
  const { allowTestLoopbackOrigin } = await import('../../lib/ssrfGuard.js');
  const disallow = allowTestLoopbackOrigin('http://127.0.0.1');
  try {
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]);
    return await fn();
  } finally {
    disallow();
    if (previousDir === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousDir;
    await h.q(`DELETE FROM media_assets WHERE item_id = ANY($1)`, [itemIds]).catch(() => undefined);
    await h.q(`DELETE FROM app_settings WHERE key = ANY($1)`, [SETTING_KEYS]).catch(() => undefined);
    for (const row of previous) await h.q(`INSERT INTO app_settings (key, value) VALUES ($1, $2)`, [row.key, row.value]).catch(() => undefined);
  }
}

/** Makes a new cover of the item (the old one stops being the cover) with its light WEBP on disk; its SHA-256 */
async function setCover(h: Harness, itemId: number): Promise<string> {
  const sha = crypto.randomBytes(32).toString('hex');
  const { mediaFilePath } = await import('../../lib/media/mediaPaths.js');
  const file = mediaFilePath(sha, 'light', 'webp');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(`RIFF-webp-${sha}`));
  const [section] = await h.q(`SELECT id FROM media_sections WHERE kind = 'products' AND is_deleted = 0 ORDER BY id LIMIT 1`);
  await h.q(`UPDATE media_assets SET is_cover = 0 WHERE item_id = $1 AND is_cover = 1`, [itemId]);
  await h.q(`INSERT INTO media_assets (section_id, item_id, kind, mime_type, size_bytes, sha256, is_cover, light_bytes)
    VALUES ($1, $2, 'image', 'image/jpeg', 10, $3, 1, 20)`, [section.id, itemId, sha]);
  return sha;
}

async function linkMedia(h: Harness, itemId: number) {
  const [row] = await h.q(`SELECT id, site_image_id, cover_sent_sha256, image_error, image_failure_count, sent_tag_ids, sent_collections
    FROM wc_product_links WHERE is_deleted = 0 AND item_id = $1`, [itemId]);
  return row as Record<string, unknown> | undefined;
}

/** a step the rest of the case depends on failed: the case fails with it */
const fail = (wrong: string[], what: string) => {
  wrong.push(what);
  return what;
};

const publicGet = (h: Harness, url: string) => request(h.app as Parameters<typeof request>[0]).get(url);
const pathOf = (src: string | undefined) => (src ? new URL(src).pathname : '/api/woocommerce/shop-image/none.webp');

/**
 * The image push: off by default; turning it on needs media.manage, the secrets key and a public address WordPress can
 * download from; the first comparison only records a product that already has a shop image, one without gets the cover, a
 * variation its own image; a changed cover replaces the featured image and keeps the gallery; a cover taken away removes
 * nothing; the signed address answers the light WEBP to anyone and every wrong, old or late address is the same 404
 */
export async function imagePushCase(h: Harness, wrong: string[]): Promise<string> {
  const had = await newItem(h, 'IH');
  const bare = await newItem(h, 'IB');
  const none = await newItem(h, 'IN');
  const variation = await newItem(h, 'IV');
  const products: MockProduct[] = [
    { id: 1, sku: had.code, images: [501, 502] },
    { id: 2, sku: bare.code },
    { id: 3, sku: none.code },
    // PR #421 review: WooCommerce shows a variation without its own image with its parent's featured image (601)
    { id: 4, sku: `IVPAR_${h.tag}`, images: [601], variations: [{ id: 41, sku: variation.code }] },
  ];
  const ids = [had.id, bare.id, none.id, variation.id];
  return withMediaSettings(h, ids, () => withShop(h, products, async (store) => {
    const { runImagePushOnce } = await import('../../services/woocommerce/wcImagePush.service.js');
    const { signedImageFile } = await import('../../services/woocommerce/wcShopImageLink.js');
    const off = await runImagePushOnce();
    if (off.state !== 'off' || store.requests.length > 0) wrong.push(`with the setting absent the run was ${off.state}`);

    // switching: woocommerce.manage alone cannot turn it on but can turn it off; the address and the key are checked
    const manager = await h.sessionWith(['woocommerce.manage']);
    const denied = await h.post('/api/woocommerce/image-push', { enabled: true, mediaBaseUrl: PUBLIC_BASE }, manager);
    if (denied.status !== 403 || (denied.body as { code?: string }).code !== 'WC_IMAGE_PUSH_NEEDS_MEDIA') wrong.push(`woocommerce.manage alone turned it on: ${brief(denied)}`);
    const offByManager = await h.post('/api/woocommerce/image-push', { enabled: false }, manager);
    if (offByManager.status !== 200) wrong.push(`woocommerce.manage could not turn it off: ${brief(offByManager)}`);
    for (const bad of ['ftp://shop.example', 'https://shop.example:22', 'http://10.0.0.5', 'http://127.0.0.1:9', 'https://u:p@shop.example', 'nothing']) {
      const res = await h.post('/api/woocommerce/image-push', { enabled: true, mediaBaseUrl: bad });
      if (res.status !== 422 || (res.body as { code?: string }).code !== 'WC_MEDIA_BASE_URL_INVALID') wrong.push(`the address ${bad} answered ${brief(res)}`);
    }
    const key = process.env.ERP_SECRETS_KEY;
    process.env.ERP_SECRETS_KEY = '';
    const keyless = await h.post('/api/woocommerce/image-push', { enabled: true, mediaBaseUrl: PUBLIC_BASE });
    process.env.ERP_SECRETS_KEY = key;
    if ((keyless.body as { code?: string }).code !== 'WC_IMAGE_PUSH_NEEDS_SECRETS_KEY') wrong.push(`without the secrets key: ${brief(keyless)}`);
    const [stillOff] = await h.q(`SELECT value FROM app_settings WHERE key = 'wc_image_push'`);
    if (stillOff?.value === '1') wrong.push('a refused switch left the image push on');
    const media = await h.sessionWith(['woocommerce.manage', 'media.manage']);
    const on = await h.post('/api/woocommerce/image-push', { enabled: true, mediaBaseUrl: `${PUBLIC_BASE}/` }, media);
    if (on.status !== 200 || (on.body as { baseUrl?: string }).baseUrl !== PUBLIC_BASE) return fail(wrong, `turning it on answered ${brief(on)}`);

    // before a refresh no shop image was read, so nothing is compared
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return fail(wrong, `refresh ${brief(refresh)}`);
    const readIds = await Promise.all([had, bare, variation].map(async i => Number((await linkMedia(h, i.id))?.site_image_id)));
    if (readIds.join() !== '501,0,0') wrong.push(`the refresh read the shop image ids ${readIds.join()}, expected 501,0,0`);
    const firstHad = await setCover(h, had.id);
    const bareCover = await setCover(h, bare.id);
    await setCover(h, variation.id);
    const view = ((await h.get('/api/woocommerce/catalog')).body as { shopSync?: { image?: { enabled?: boolean; pending?: number } } }).shopSync?.image;
    if (!view?.enabled || view.pending !== 2) wrong.push(`the tab shows ${JSON.stringify(view)}, expected on with two products waiting`);

    store.requests.length = 0;
    const first = await runImagePushOnce();
    if (first.state !== 'pushed' || first.result?.syncedCount !== 2) wrong.push(`first run ${JSON.stringify(first).slice(0, 300)}, expected two images sent`);
    if (store.imageSrcSent.has(1) || store.imageSrcSent.has(3) || !store.imageSrcSent.has(2) || !store.imageSrcSent.has(41)) {
      wrong.push(`images sent to ${[...store.imageSrcSent.keys()].join()}, expected 2 and 41 only`);
    }
    if (JSON.stringify(products[0].images) !== '[501,502]') wrong.push(`a product that had a shop image was changed: ${JSON.stringify(products[0].images)}`);
    if ((await linkMedia(h, had.id))?.cover_sent_sha256 !== firstHad) wrong.push('the cover of a product with a shop image was not taken as its baseline');
    if ((await linkMedia(h, none.id))?.cover_sent_sha256 !== 'none') wrong.push('an item without a cover was not recorded as compared');
    if (Number((await linkMedia(h, bare.id))?.site_image_id) !== products[1].images?.[0]) wrong.push('the new shop image id was not kept on the link');
    if (!store.requests.some(r => r.startsWith('POST products/4/variations/batch'))) wrong.push(`the variation image did not go through its parent's batch: ${store.requests.join(', ')}`);
    if (store.batchSizes.some(n => n > 5)) wrong.push(`an image batch held ${Math.max(...store.batchSizes)} rows, more than five`);

    // the signed address: the light WEBP to anyone without a session, the same 404 for anything else
    const bareSrc = store.imageSrcSent.get(2);
    const variationSrc = store.imageSrcSent.get(41);
    if (!bareSrc?.startsWith(`${PUBLIC_BASE}/api/woocommerce/shop-image/`) || !bareSrc.endsWith('.webp')) wrong.push(`the image address sent was ${bareSrc}`);
    const served = await publicGet(h, pathOf(bareSrc)).buffer(true);
    if (served.status !== 200 || !String(served.headers['content-type']).startsWith('image/webp') || String(served.body) !== `RIFF-webp-${bareCover}`) {
      wrong.push(`the signed address answered ${served.status} ${served.headers["content-type"]}`);
    }
    if (served.headers['cache-control'] !== 'no-store' || served.headers['x-content-type-options'] !== 'nosniff') wrong.push(`the image headers ${JSON.stringify(served.headers)}`);
    const bareLink = Number((await linkMedia(h, bare.id))?.id);
    const noneLink = Number((await linkMedia(h, none.id))?.id);
    const file = pathOf(bareSrc).split('/').pop() ?? '';
    const flipped = file.replace(/-([A-Za-z0-9_-])([A-Za-z0-9_-]{21})\.webp$/, (_m, c: string, rest: string) => `-${c === 'A' ? 'B' : 'A'}${rest}.webp`);
    const refusals: Record<string, string> = {
      'a changed signature': flipped,
      'another link': file.replace(/^\d+-/, `${bareLink + 1000}-`),
      'an expired address': signedImageFile(bareLink, bareCover, Date.now() - 20 * 60_000) ?? '',
      'an address too far ahead': signedImageFile(bareLink, bareCover, Date.now() + 60 * 60_000) ?? '',
      'an item without a cover': signedImageFile(noneLink, bareCover) ?? '',
      'a name of another shape': `${bareLink}.webp`,
      'a path outside': '..%2F..%2Fetc%2Fpasswd',
      // PR #421 review: a link id above PostgreSQL's integer failed the query (422) while the push was on
      'a link id above the integer': file.replace(/^\d+-/, '2147483648-'),
      'a link id of ten nines': file.replace(/^\d+-/, '9999999999-'),
      'another cover mark': file.replace(/^(\d+)-[0-9a-f]{12}-/, (_m, id: string) => `${id}-000000000000-`),
    };
    const bodies = new Set<string>();
    for (const [what, name] of Object.entries(refusals)) {
      const res = await publicGet(h, `/api/woocommerce/shop-image/${name}`);
      if (res.status !== 404) wrong.push(`${what} answered ${res.status}`);
      bodies.add(JSON.stringify((res.body as { code?: string; error?: string }).code ?? res.body));
    }
    if (bodies.size !== 1) wrong.push(`the refusals differ: ${[...bodies].join(' | ')}`);

    const batches = store.batchSizes.length;
    const idle = await runImagePushOnce();
    if (idle.state !== 'nothing' || store.batchSizes.length !== batches) wrong.push(`a run with no cover changed was ${idle.state}`);

    // a changed cover replaces the featured image and keeps the gallery; the old cover's address dies
    const oldHadFile = signedImageFile(Number((await linkMedia(h, had.id))?.id), firstHad) ?? '';
    const secondHad = await setCover(h, had.id);
    const changed = await runImagePushOnce();
    if (changed.state !== 'pushed' || changed.result?.syncedCount !== 1) wrong.push(`a changed cover run ${JSON.stringify(changed).slice(0, 300)}`);
    const gallery = products[0].images ?? [];
    if (gallery.length !== 2 || gallery[0] === 501 || gallery[1] !== 502) wrong.push(`the product images became ${JSON.stringify(gallery)}, expected a new featured image and 502 kept`);
    if ((await linkMedia(h, had.id))?.cover_sent_sha256 !== secondHad) wrong.push('the changed cover was not recorded as sent');
    if ((await publicGet(h, `/api/woocommerce/shop-image/${oldHadFile}`)).status !== 404) wrong.push('the address of a replaced cover still answers');

    // a cover taken away is recorded and removes nothing
    await h.q(`UPDATE media_assets SET is_deleted = 1, is_cover = 0 WHERE item_id = $1`, [bare.id]);
    const keptImages = JSON.stringify(products[1].images);
    const removed = await runImagePushOnce();
    if (removed.state !== 'nothing' || JSON.stringify(products[1].images) !== keptImages) wrong.push(`taking a cover away ran ${removed.state} and left ${JSON.stringify(products[1].images)}`);
    if ((await linkMedia(h, bare.id))?.cover_sent_sha256 !== 'none') wrong.push('a cover taken away was not recorded');

    // PR #421 review: a slow shop that kept the images after their answer was lost gets no second copy; the next run finds
    // them on the product and the variation by their file name and only records them
    const thirdHad = await setCover(h, had.id);
    const secondVariation = await setCover(h, variation.id);
    store.applyThenFail = new Set(['products/batch', 'products/4/variations/batch']);
    const lost = await runImagePushOnce();
    store.applyThenFail = undefined;
    const landedProduct = products[0].images?.[0];
    const landedVariation = products[3].variations?.[0].imageId;
    if (lost.state !== 'failed' || (await linkMedia(h, had.id))?.cover_sent_sha256 === thirdHad) wrong.push(`a run whose answers were lost was ${lost.state}`);
    if (!store.imageSrc.get(Number(landedProduct))?.includes(`-${thirdHad.slice(0, 12)}-`)) wrong.push(`the shop image is not named after the file: ${store.imageSrc.get(Number(landedProduct))}`);
    const sentBefore = store.batchSizes.length;
    const retry = await runImagePushOnce(later(1));
    if (store.batchSizes.length !== sentBefore) wrong.push(`the images that landed were sent again (${retry.state})`);
    // delta review SF-1: the run that found them records them as sent, so the last run no longer shows the failure
    if (retry.state !== 'pushed' || retry.result?.syncedCount !== 2) wrong.push(`the run that found the landed images was ${JSON.stringify(retry).slice(0, 200)}`);
    const [lastRun] = await h.q(`SELECT status FROM wc_sync_runs WHERE kind = 'image_push' ORDER BY id DESC LIMIT 1`);
    if (lastRun?.status !== 'ok') wrong.push(`the last image run row is ${lastRun?.status}`);
    if (JSON.stringify(products[0].images) !== JSON.stringify([landedProduct, 502])) wrong.push(`the product images became ${JSON.stringify(products[0].images)}`);
    const afterHad = await linkMedia(h, had.id);
    const afterVariation = await linkMedia(h, variation.id);
    if (afterHad?.cover_sent_sha256 !== thirdHad || Number(afterHad?.site_image_id) !== landedProduct) wrong.push(`the landed product image was recorded as ${JSON.stringify(afterHad)}`);
    if (afterVariation?.cover_sent_sha256 !== secondVariation || Number(afterVariation?.site_image_id) !== landedVariation) wrong.push(`the landed variation image was recorded as ${JSON.stringify(afterVariation)}`);
    // delta review SF-2: a parent whose variations the shop does not answer is sent as before, the run does not fail
    const thirdVariation = await setCover(h, variation.id);
    store.statusPaths.set('products/4/variations', 404);
    const unread = await runImagePushOnce(later(2));
    store.statusPaths.delete('products/4/variations');
    if (unread.state !== 'pushed' || (await linkMedia(h, variation.id))?.cover_sent_sha256 !== thirdVariation) wrong.push(`with the variations unread the run was ${JSON.stringify(unread).slice(0, 200)}`);

    // turned off, even a valid address is refused
    const variationFile = `/api/woocommerce/shop-image/${signedImageFile(Number(afterVariation?.id), thirdVariation)}`;
    if ((await publicGet(h, pathOf(variationSrc))).status !== 404) wrong.push('the address of a replaced variation cover still answers');
    if ((await publicGet(h, variationFile)).status !== 200) wrong.push('a valid variation address was refused');
    await h.post('/api/woocommerce/image-push', { enabled: false }, manager);
    if ((await publicGet(h, variationFile)).status !== 404) wrong.push('the image address answers while the push is off');
    return `${store.requests.length} shop requests`;
  }));
}

/**
 * The collection push: off by default; turning it on needs a key that edits a product's collections; an item's collections
 * become tags of its simple or parent product (never a variation), a missing tag is made (one made meanwhile answers
 * `term_exists` and is used), and only the tags the program added are ever taken away
 */
export async function collectionPushCase(h: Harness, wrong: string[]): Promise<string> {
  const many = await newItem(h, 'CM');
  const own = await newItem(h, 'CO');
  const bare = await newItem(h, 'CB');
  const variation = await newItem(h, 'CV');
  const products: MockProduct[] = [
    { id: 1, sku: many.code, tags: [80] },
    { id: 2, sku: own.code, tags: [81] },
    { id: 3, sku: bare.code },
    { id: 4, sku: `CVPAR_${h.tag}`, variations: [{ id: 41, sku: variation.code }] },
  ];
  const setCollections = (id: number, names: string[]) => h.q(`UPDATE items SET collections = $2::text[] WHERE id = $1`, [id, names]);
  return withMediaSettings(h, [], () => withShop(h, products, async (store) => {
    store.tags.push({ id: 70, name: 'Summer & Sun' }, { id: 81, name: 'Gold' });
    store.hiddenTags.push({ id: 90, name: 'Bronze' });
    const { runCollectionPushOnce } = await import('../../services/woocommerce/wcCollectionPush.service.js');
    await setCollections(many.id, ['summer & sun', 'Silver', 'Bronze']);
    await setCollections(own.id, ['Gold']);
    await setCollections(variation.id, ['Gold']);
    const off = await runCollectionPushOnce();
    if (off.state !== 'off' || store.requests.length > 0) wrong.push(`with the setting absent the run was ${off.state}`);

    const manager = await h.sessionWith(['woocommerce.manage']);
    const denied = await h.post('/api/woocommerce/collection-push', { enabled: true }, manager);
    if (denied.status !== 403 || (denied.body as { code?: string }).code !== 'WC_COLLECTION_PUSH_NEEDS_PRODUCT_INFO') wrong.push(`woocommerce.manage alone turned it on: ${brief(denied)}`);
    const editor = await h.sessionWith(['woocommerce.manage', 'products.edit']);
    const on = await h.post('/api/woocommerce/collection-push', { enabled: true }, editor);
    if (on.status !== 200) return fail(wrong, `turning it on answered ${brief(on)}`);
    const refresh = await h.post('/api/woocommerce/refresh-products', {});
    if (refresh.status !== 200) return fail(wrong, `refresh ${brief(refresh)}`);

    store.requests.length = 0;
    const first = await runCollectionPushOnce(later(1));
    if (first.state !== 'pushed' || first.result?.syncedCount !== 2) wrong.push(`first run ${JSON.stringify(first).slice(0, 300)}, expected two products`);
    const silver = store.tags.find(t => t.name === 'Silver')?.id;
    if (!silver) return fail(wrong, `the tag Silver was not made: ${JSON.stringify(store.tags)}`);
    if (store.tags.some(t => t.name === 'Bronze')) wrong.push('a tag the shop already had was made twice');
    const sorted = (ids: number[] | undefined) => JSON.stringify([...(ids ?? [])].sort((a, b) => a - b));
    if (sorted(products[0].tags) !== sorted([80, 70, silver, 90])) wrong.push(`product 1 tags ${JSON.stringify(products[0].tags)}, expected the shop's 80 kept and 70, Silver, 90 added`);
    if (sorted(products[1].tags) !== '[81]') wrong.push(`product 2 tags ${JSON.stringify(products[1].tags)}`);
    if (store.tagsSent.has(3) || store.tagsSent.has(41) || store.tagsSent.has(4)) wrong.push(`tags went to ${[...store.tagsSent.keys()].join()}`);
    const mine = (await linkMedia(h, many.id))?.sent_tag_ids;
    if (!Array.isArray(mine) || sorted(mine as number[]) !== sorted([70, silver, 90])) wrong.push(`the program's tags of product 1 ${JSON.stringify(mine)}`);
    if (sorted((await linkMedia(h, own.id))?.sent_tag_ids as number[]) !== '[]') wrong.push('a tag the product already had was counted as the program\'s');
    if ((await linkMedia(h, bare.id))?.sent_collections !== '') wrong.push('an item without collections was not recorded as compared');

    const batches = store.batchSizes.length;
    const idle = await runCollectionPushOnce(later(1));
    if (idle.state !== 'nothing' || store.batchSizes.length !== batches) wrong.push(`a run with no collection changed was ${idle.state}`);

    // a collection taken away removes only the program's tag; the shop's own tags stay
    await setCollections(many.id, ['SILVER']);
    await setCollections(own.id, []);
    products[0].tags = [...(products[0].tags ?? []), 85];
    const second = await runCollectionPushOnce(later(1));
    if (second.state !== 'pushed') wrong.push(`the second run was ${second.state}`);
    if (sorted(products[0].tags) !== sorted([80, 85, silver])) wrong.push(`product 1 tags became ${JSON.stringify(products[0].tags)}, expected 80, 85 and Silver`);
    if (sorted(products[1].tags) !== '[81]') wrong.push(`the shop's own tag left product 2: ${JSON.stringify(products[1].tags)}`);

    // PR #421 review: a tag added by a send whose answer was lost stays the program's and leaves with its collection
    await setCollections(own.id, ['Platinum']);
    store.applyThenFail = new Set(['products/batch']);
    const lost = await runCollectionPushOnce(later(1));
    store.applyThenFail = undefined;
    const platinum = store.tags.find(t => t.name === 'Platinum')?.id;
    if (lost.state !== 'failed' || !platinum || !products[1].tags?.includes(platinum)) wrong.push(`a run whose answer was lost was ${lost.state}, tags ${JSON.stringify(products[1].tags)}`);
    const claimed = (await linkMedia(h, own.id))?.sent_tag_ids;
    await setCollections(own.id, []);
    const cleaned = await runCollectionPushOnce(later(2));
    if (sorted(products[1].tags) !== '[81]') wrong.push(`a tag whose answer was lost stayed on product 2: ${JSON.stringify(products[1].tags)} (claimed ${JSON.stringify(claimed)}, run ${JSON.stringify(cleaned).slice(0, 200)})`);

    // PR #421 review: a name the shop will not make refuses only its product; the others still go
    await setCollections(bare.id, ['<>']);
    await setCollections(many.id, ['Silver', 'Gold']);
    const refusedName = await runCollectionPushOnce(later(3));
    if (refusedName.state !== 'pushed' || refusedName.result?.failedCount !== 1) wrong.push(`a run with a name the shop refused was ${JSON.stringify(refusedName).slice(0, 300)}`);
    const [refusedLink] = await h.q(`SELECT collection_error FROM wc_product_links WHERE is_deleted = 0 AND item_id = $1`, [bare.id]);
    if (!String(refusedLink?.collection_error).includes('<>')) wrong.push(`the refused name was recorded as ${refusedLink?.collection_error}`);
    if (store.tagsSent.has(3) || sorted(products[0].tags) !== sorted([80, 85, silver, 81])) wrong.push(`after a refused name product 1 tags ${JSON.stringify(products[0].tags)}, product 3 sent ${store.tagsSent.has(3)}`);

    // delta review N-1: a row the shop refused was not applied, so the tags claimed for it go back
    await setCollections(own.id, ['Copper']);
    store.rowErrors.add(2);
    const rowRefused = await runCollectionPushOnce(later(4));
    store.rowErrors.delete(2);
    const afterRefusal = (await linkMedia(h, own.id))?.sent_tag_ids;
    if (sorted(afterRefusal as number[]) !== '[]') wrong.push(`a refused row kept the claimed tags ${JSON.stringify(afterRefusal)} (${rowRefused.state})`);

    await h.post('/api/woocommerce/collection-push', { enabled: false }, manager);
    await setCollections(many.id, []);
    const stopped = await runCollectionPushOnce(later(1));
    if (stopped.state !== 'off') wrong.push(`a run after turning it off was ${stopped.state}`);
    return `${store.requests.length} shop requests`;
  }));
}
