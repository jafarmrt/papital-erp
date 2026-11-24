import net from 'net';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { NotFoundError, UnauthorizedError } from '../errors/customErrors.js';
import { isStorefrontApiKey, isStorefrontEnabled } from '../services/storefront/storefrontSettings.service.js';
import {
  CATALOG_PAGE_MAX, CATALOG_SORTS, catalogFacets, catalogPage, productBySlug, publicSettings, storefrontMediaFile, type CatalogSort,
} from '../services/storefront/storefrontCatalog.service.js';
import { STOREFRONT_QUERY_TEXT_MAX, STOREFRONT_SLUG_MAX } from '../lib/storefront/storefrontRules.js';
import { publicBrand } from '../services/storefront/storefrontBrand.service.js';
import {
  GIFT_MESSAGE_MAX, ORDER_LINES_MAX, ORDER_TRACK_TRIES_PER_ORDER_HOUR, ORDER_TRACK_TRIES_PER_VISITOR_HOUR, PAYMENT_METHODS,
} from '../lib/storefront/storefrontOrderRules.js';
import { claimOrder, myOrder, myOrders, sendAccountReceipt } from '../services/storefront/storefrontAccountOrders.service.js';
import { myAddresses, removeAddress, setDefaultAddress } from '../services/storefront/storefrontBuyerAddresses.service.js';
import { placeOrder, quoteShipping } from '../services/storefront/storefrontOrderPlace.service.js';
import { buyerOrder, sendReceipt } from '../services/storefront/storefrontOrderBuyer.service.js';
import { orderAccessByPhone } from '../services/storefront/storefrontOrderTrack.service.js';
import { EMAIL_ADDRESS_MAX, EMAIL_PROOF_MAX } from '../lib/storefront/storefrontEmailRules.js';
import { storefrontEmailRoutes } from './storefrontApiEmail.routes.js';
import { PAGE_PREVIEW_KEY_MAX, PAGE_SLUG_MAX } from '../lib/storefront/storefrontPageRules.js';
import { contentImageFile, publicPage, publicPages } from '../services/storefront/storefrontPagePublic.js';
import { publicHome } from '../services/storefront/storefrontHomePublic.js';
import { newsImageFile, publicNewsIndex, publicNewsItem, publicNewsList } from '../services/storefront/storefrontNewsPublic.js';
import { collectionImageFile, publicCollectionTexts } from '../services/storefront/storefrontCollections.service.js';
import { pagePreviewImageFile, publicPagePreview } from '../services/storefront/storefrontPagePreview.service.js';
import { ACCESS_KEY_MAX } from '../services/storefront/storefrontOrderKeys.js';
import { publicSeo } from '../services/storefront/storefrontSeo.service.js';
import { publicShopInfo } from '../services/storefront/storefrontShopInfo.service.js';
import { catalogFeed } from '../services/storefront/storefrontFeed.service.js';
import { campaignHeroFile, publicCampaign, publicCampaigns } from '../services/storefront/storefrontCampaigns.service.js';
import { publicMenus } from '../services/storefront/storefrontMenuPublic.js';
import { CAMPAIGN_SLUG_MAX } from '../lib/storefront/storefrontCampaignRules.js';
import { publicRedirects } from '../services/storefront/storefrontRedirects.service.js';
import { requestOtp, verifyOtp } from '../services/storefront/storefrontSmsOtp.service.js';
import { RECEIPT_IMAGE_DATA_URL_MAX } from '../services/storefront/storefrontReceiptImage.js';
import { myAccount, myGroupPrices, registerAccount, setPasswordWithLink, signIn, signOut, smsSignIn } from '../services/storefront/storefrontBuyerAuth.service.js';
import { applyForWholesale } from '../services/storefront/storefrontWholesaleApply.service.js';
import { submitCorporateGift } from '../services/storefront/storefrontInquiry.service.js';
import { submitFormAnswers } from '../services/storefront/storefrontMessages.service.js';
import { FORM_FIELDS_MAX, FORM_KEY_MAX } from '../lib/storefront/storefrontFormRules.js';
import { MESSAGES_PER_VISITOR_HOUR, MESSAGE_TRIES_PER_MINUTE } from '../lib/storefront/storefrontMessageRules.js';
import { FORM_STAMP } from '../services/storefront/storefrontFormStamp.js';
import { BUYER_TOKEN_MAX } from '../services/storefront/storefrontBuyerSecrets.js';
import { PASSWORD_MAX } from '../lib/storefront/storefrontBuyerRules.js';
import { PHONE_PROOF_MAX } from '../lib/storefront/storefrontSmsRules.js';

/**
 * v11 phase 8.1 (package 18, start plan §3): the Storefront API, read only, `GET /api/storefront/v1/...`. Only the site
 * app's server calls it, with `Authorization: Bearer <key>` (the key made in the «فروشگاه سایت» tab; the database keeps
 * its SHA-256). No route here takes a session: these are in `PUBLIC_ROUTES` of the route access policy because the key,
 * not a user, is the guard. A missing or wrong key is the same 401; the rate limit is per address, and generous because
 * one app server makes every call. While the owner has not turned the site on (`sf_enabled`, default off) every route is
 * 404, key or not. The answers name no cost, no other price list, no warehouse, no customer and no accounting data.
 */
const router = Router();
export const STOREFRONT_API_REQUESTS_PER_MINUTE = 1200;

const limiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_API_REQUESTS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `storefront:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || '127.0.0.1')}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

const requireStorefrontKey = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  // off by default (shared repository rule: a new storefront feature merges switched off): every route is the same 404
  if (!(await isStorefrontEnabled())) throw new NotFoundError('پیدا نشد');
  const header = String(req.headers.authorization ?? '');
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!(await isStorefrontApiKey(presented))) throw new UnauthorizedError('کلید برنامه سایت پذیرفته نشد.');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.use(limiter, requireStorefrontKey);

/**
 * v11 phase 8.2a: the writes (a quote, an order, a receipt) have a tighter limit of their own, per buyer: the app's server
 * forwards the buyer's address in `X-Storefront-Client-IP` (read only after the key passed, and only when it is an IP
 * address); without it the limit is the app server's. A buyer's order is read and written only with its tracking key, in
 * `X-Order-Key`, never in the address, so it stays out of access logs.
 */
export const STOREFRONT_WRITES_PER_MINUTE = 30;
const buyerAddress = (req: Request): string => {
  const forwarded = String(req.headers['x-storefront-client-ip'] ?? '').trim();
  return net.isIP(forwarded) ? forwarded : (req.ip || req.socket?.remoteAddress || '127.0.0.1');
};
const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_WRITES_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `storefront-write:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
/**
 * v12 phase 7 (site review 1.4): the catalog reads the site makes for one visitor (a search its cache cannot answer) name
 * the visitor in `X-Storefront-Client-IP`, and each visitor gets this many a minute of their own, so one script cannot
 * fill the shared read limit above. Reads without the header (the site's shared, cached reads) count only there.
 */
export const STOREFRONT_VISITOR_READS_PER_MINUTE = 120;
const visitorReadLimiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_VISITOR_READS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !net.isIP(String(req.headers['x-storefront-client-ip'] ?? '').trim()),
  keyGenerator: (req) => `storefront-read:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
const orderKeyOf = (req: Request): string => String(req.headers['x-order-key'] ?? '').trim().slice(0, ACCESS_KEY_MAX + 1);
/** v11 phase 8.2b: a signed-in buyer's session token (the app keeps it in an httpOnly cookie and forwards it) */
const sessionOf = (req: Request): string => String(req.headers['x-buyer-session'] ?? '').trim().slice(0, BUYER_TOKEN_MAX + 1);

const cartLine = z.object({ slug: z.string().min(1).max(STOREFRONT_SLUG_MAX), quantity: z.number().int() }).strict();
const cartLines = z.array(cartLine).min(1).max(ORDER_LINES_MAX);
const quoteSchema = z.object({ body: z.object({ province: z.string().max(60), lines: cartLines, discountCode: z.string().max(40).optional() }).strict() });
const orderSchema = z.object({
  body: z.object({
    requestKey: z.string().max(80), recipientName: z.string().max(200), phone: z.string().max(40), province: z.string().max(60),
    city: z.string().max(120), address: z.string().max(800), postalCode: z.string().max(40), note: z.string().max(1000),
    shippingMethod: z.string().max(60), lines: cartLines, paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    discountCode: z.string().max(40).optional(), phoneProof: z.string().max(PHONE_PROOF_MAX + 1).optional(),
    // v12 phase 8c: the buyer apart from the recipient, a gift and the address book
    buyerName: z.string().max(200).optional(), recipientPhone: z.string().max(40).optional(), gift: z.boolean().optional(),
    giftMessage: z.string().max(GIFT_MESSAGE_MAX * 2).optional(), saveAddress: z.boolean().optional(),
    // v12 phase 8e: the buyer's email and its proof («حالت بی پیامک»)
    email: z.string().max(EMAIL_ADDRESS_MAX + 6).optional(), emailProof: z.string().max(EMAIL_PROOF_MAX + 1).optional(),
  }).strict(),
});
const orderNumberParams = z.object({ number: z.string().min(1).max(20) }).passthrough();
const orderReadSchema = z.object({ params: orderNumberParams });
const receiptSchema = z.object({
  params: orderNumberParams,
  body: z.object({
    reference: z.string().max(80), paidAt: z.string().max(40), cardLast4: z.string().max(20), amount: z.string().max(40),
    image: z.string().max(RECEIPT_IMAGE_DATA_URL_MAX).optional(),
  }).strict(),
});

const catalogSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    q: z.string().max(STOREFRONT_QUERY_TEXT_MAX).optional(),
    collection: z.string().max(STOREFRONT_QUERY_TEXT_MAX).optional(),
    category: z.string().max(STOREFRONT_QUERY_TEXT_MAX).optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
  }).passthrough(),
});
const slugSchema = z.object({ params: z.object({ slug: z.string().min(1).max(STOREFRONT_SLUG_MAX) }).passthrough() });
const campaignSlugSchema = z.object({ params: z.object({ slug: z.string().min(1).max(CAMPAIGN_SLUG_MAX) }).passthrough() });
// a page's address is lowercase Latin, so anything else (a NUL among them, which PostgreSQL refuses) is not asked of the database
const pageSlugSchema = z.object({ params: z.object({ slug: z.string().min(1).max(PAGE_SLUG_MAX).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }).passthrough() });
// v12 phase 10d: a page of the list of news, 1 to 9999 (the site asks for no page past the list's last)
const newsListSchema = z.object({ query: z.object({ page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).optional() }).passthrough() });
const mediaSchema = z.object({ params: z.object({ file: z.string().min(1).max(80) }).passthrough() });

router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicSettings() });
}));

// v11 phase 8.3: the site's logo and browser icon (the logo falls back to the company logo of the general settings)
router.get('/brand', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicBrand() });
}));

// v11 phase 8.5: search-engine verification codes, the visit-statistics service, the other-language site, and the
// redirects of the old WooCommerce addresses (old path → a product slug, a collection or category name, or a site path)
router.get('/seo', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicSeo() });
}));

// v12 phase 10a: «اطلاعات فروشگاه»: the brand's name and motto, contact details, social pages, the footer's texts, the
// e-namad seal and the floating WhatsApp button (its own security review: no customer, amount or secret)
router.get('/shop-info', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicShopInfo() });
}));

router.get('/redirects', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicRedirects() });
}));

router.get('/products', visitorReadLimiter, validate(catalogSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; q?: string; collection?: string; category?: string; sort?: CatalogSort };
  res.json(await catalogPage({
    page: query.page ?? 1, limit: Math.min(query.limit ?? 24, CATALOG_PAGE_MAX), q: query.q ?? '',
    collection: query.collection ?? '', category: query.category ?? '', sort: query.sort ?? 'default',
  }));
}));

router.get('/products/:slug', validate(slugSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await productBySlug(String(req.params.slug)) });
}));

// v11 phase 8.5b: every item on the site with the fields of a product feed (the site writes Google's format)
router.get('/feed', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await catalogFeed() });
}));

// v12 phase 9c: the menus the site shows (each place while it is on, only the links the site has now)
router.get('/menus', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicMenus() });
}));

// v11 phase 8.5b: «صفحه‌های ویژه», the campaign pages on the site now (on, inside their window), and one of them
router.get('/campaigns', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicCampaigns() });
}));

router.get('/campaigns/:slug', validate(campaignSlugSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await publicCampaign(String(req.params.slug)) });
}));

// v12 phase 10c: «صفحه‌های سایت», the published copy of each page (never its draft, its editor or a row id), and one of them
router.get('/pages', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicPages() });
}));

router.get('/pages/:slug', validate(pageSlugSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await publicPage(String(req.params.slug)) });
}));

// v12 phase 10d: «خبرهای سایت»: the items on the site now (the copy on the site of each, its day come), a page at a time,
// their addresses for the sitemap, and one of them; nothing while «خبرها روی سایت بیایند» is off
router.get('/news', validate(newsListSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json(await publicNewsList((req.query as { page?: number }).page ?? 1));
}));

router.get('/news-index', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicNewsIndex() });
}));

router.get('/news/:slug', validate(pageSlugSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await publicNewsItem(String(req.params.slug)) });
}));

// v12 phase 10e: «صفحهٔ اصلی» as the shop wrote and published it in the ERP, built for today (a part switched off, a slide
// outside its days and a button whose target is not on the site now are left out); 404 until it is published, and the
// site then keeps the home page in its own code
router.get('/home', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicHome() });
}));

// v12 phase 10e: «کالکشن‌های سایت»: the words the shop wrote for each collection that has an item on the site now (its
// introduction, its image, the address of «آشنایی بیشتر»); never a row id, an editor or a collection with no item on the site
router.get('/collections', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await publicCollectionTexts() });
}));

router.get('/facets', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await catalogFacets() });
}));

/**
 * A photo of an item on the site, else (v11 phase 8.5b) the hero image of a campaign page on the site now, else (v12
 * phase 10c) an image a published page names, else (10d) an image a news item on the site now names, else (10e) the
 * image of a collection that has an item on the site now; an image of a draft is the same 404 as a file that does not exist
 */
async function siteMediaFile(file: string): Promise<string> {
  try {
    return await storefrontMediaFile(file);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  try {
    return await campaignHeroFile(file);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  try {
    return await contentImageFile(file);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  try {
    return await newsImageFile(file);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return collectionImageFile(file);
}

const sendImage = (res: Response, filePath: string, cacheControl: string) => new Promise<void>((resolve, reject) => {
  res.sendFile(filePath, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' }, dotfiles: 'deny' },
    (err) => (err && !res.headersSent ? reject(new NotFoundError('پیدا نشد')) : resolve()));
});

router.get('/media/:file', validate(mediaSchema), asyncHandler(async (req: Request, res: Response) => {
  // a file is named by its content, so the app may keep it for a long time
  await sendImage(res, await siteMediaFile(String(req.params.file)), 'private, max-age=31536000, immutable');
}));

// v12 phase 10c: a page's preview link: its saved draft in the shape of a page of the site, and the images that draft
// names, both only under the link's key and while its hour lasts. The key comes in `X-Preview-Key`, never in the
// address (as an order's key does, above), so it is in no access or error log of the ERP. The answers are `no-store`
// (every answer of this router is; the image says so itself).
const previewKeyOf = (req: Request): string => String(req.headers['x-preview-key'] ?? '').trim().slice(0, PAGE_PREVIEW_KEY_MAX + 1);

router.get('/page-preview', asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await publicPagePreview(previewKeyOf(req)) });
}));

router.get('/page-preview/media/:file', validate(mediaSchema), asyncHandler(async (req: Request, res: Response) => {
  await sendImage(res, await pagePreviewImageFile(previewKeyOf(req), String(req.params.file)), 'no-store');
}));

router.post('/shipping/quote', writeLimiter, validate(quoteSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await quoteShipping(req.body, sessionOf(req)) });
}));

router.post('/orders', writeLimiter, validate(orderSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await placeOrder(req.body, sessionOf(req)) });
}));

router.get('/orders/:number', validate(orderReadSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await buyerOrder(String(req.params.number), orderKeyOf(req)) });
}));

/**
 * v12 phase 8d (site review 2.2): a guest order opened on another phone with its buyer's phone and a proof of it. A
 * failed try counts against the visitor and against the order, each per hour; a try that opens the order does not.
 */
const trackLimiter = (max: number, key: (req: Request) => string, skip?: (req: Request) => boolean) => rateLimit({
  windowMs: 3_600_000, max, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, keyGenerator: key, skip,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
// 8d review: a request that does not name its visitor (the site without STOREFRONT_TRUST_PROXY) is not counted per
// visitor, else every buyer would share one budget and one person could close the way for all; the per-order limit stands
const trackVisitorLimiter = trackLimiter(ORDER_TRACK_TRIES_PER_VISITOR_HOUR, (req) => `storefront-track:${ipKeyGenerator(buyerAddress(req))}`,
  (req) => !net.isIP(String(req.headers['x-storefront-client-ip'] ?? '').trim()));
const trackOrderLimiter = trackLimiter(ORDER_TRACK_TRIES_PER_ORDER_HOUR, (req) => `storefront-track-order:${String(req.params.number ?? '').slice(0, 20)}`);
const accessSchema = z.object({
  params: orderNumberParams,
  body: z.union([
    z.object({ phone: z.string().max(40), phoneProof: z.string().max(PHONE_PROOF_MAX + 1) }).strict(),
    z.object({ email: z.string().max(EMAIL_ADDRESS_MAX + 6), emailProof: z.string().max(EMAIL_PROOF_MAX + 1) }).strict(),
  ]),
});
router.post('/orders/:number/access', writeLimiter, trackVisitorLimiter, trackOrderLimiter, validate(accessSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await orderAccessByPhone(String(req.params.number), req.body) });
}));

router.post('/orders/:number/receipts', writeLimiter, validate(receiptSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await sendReceipt(String(req.params.number), orderKeyOf(req), req.body) });
}));

/**
 * v11 phase 8.4a: the login code by SMS. Off (404) until the owner turns the site's texts on and gives the login code a
 * template. Asking for a code has its own tight limit per buyer address in front of the service's own limits (per
 * phone, per address and the site's budget of texts), since each code costs an SMS. A right code answers a single-use phone
 * proof for the sign-up or sign-in that follows; it opens no session by itself.
 */
export const STOREFRONT_OTP_REQUESTS_PER_MINUTE = 3;
const otpLimiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_OTP_REQUESTS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `storefront-otp:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
const otpRequestSchema = z.object({ body: z.object({ phone: z.string().max(40) }).strict() });
const otpVerifySchema = z.object({ body: z.object({ phone: z.string().max(40), code: z.string().max(20) }).strict() });

router.post('/auth/otp/request', writeLimiter, otpLimiter, validate(otpRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(202).json({ data: await requestOtp(req.body.phone, ipKeyGenerator(buyerAddress(req))) });
}));

router.post('/auth/otp/verify', writeLimiter, validate(otpVerifySchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await verifyOtp(req.body.phone, req.body.code) });
}));

/**
 * v11 phase 8.2b (start plan §6 and §8): buyer accounts. A signed-in buyer's session token travels in
 * `X-Buyer-Session` (the app keeps it in an httpOnly cookie), never in the address. Sign-in, sign-up, the set-password
 * link and the wholesale form share a tight limit per buyer address, on top of the per-account lock of the service.
 */
export const STOREFRONT_AUTH_PER_MINUTE = 10;
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: STOREFRONT_AUTH_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `storefront-auth:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
const password = z.string().max(PASSWORD_MAX * 2);
// 8.4b: the phone proof of `POST /auth/otp/verify`, needed while the site signs in by SMS
const phoneProof = z.string().max(PHONE_PROOF_MAX + 1);
// v12 phase 8e: a phone, an email or both; an email comes with its proof
const email = z.string().max(EMAIL_ADDRESS_MAX + 6);
const registerSchema = z.object({
  body: z.object({
    name: z.string().max(200), phone: z.string().max(40).optional(), email: email.optional(), password, phoneProof: phoneProof.optional(),
    emailProof: z.string().max(EMAIL_PROOF_MAX + 1).optional(),
  }).strict(),
});
const smsLoginSchema = z.object({ body: z.object({ phone: z.string().max(40), phoneProof }).strict() });
const loginSchema = z.object({ body: z.union([z.object({ phone: z.string().max(40), password }).strict(), z.object({ email, password }).strict()]) });
const setPasswordSchema = z.object({ body: z.object({ token: z.string().max(BUYER_TOKEN_MAX + 1), password }).strict() });
const applySchema = z.object({
  body: z.object({
    name: z.string().max(200), companyName: z.string().max(300), city: z.string().max(120), phone: z.string().max(40),
    nationalId: z.string().max(40), economicCode: z.string().max(40), note: z.string().max(1000), phoneProof: phoneProof.optional(),
  }).strict(),
});

router.post('/auth/register', authLimiter, validate(registerSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await registerAccount(req.body) });
}));

router.post('/auth/sms-login', authLimiter, validate(smsLoginSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await smsSignIn(req.body) });
}));

router.post('/auth/login', authLimiter, validate(loginSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await signIn(req.body) });
}));

router.post('/auth/logout', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  await signOut(sessionOf(req));
  res.json({ success: true });
}));

router.post('/auth/set-password', authLimiter, validate(setPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await setPasswordWithLink(req.body) });
}));

router.use(storefrontEmailRoutes({ writeLimiter, authLimiter, otpLimiter, buyerAddress, sessionOf }));

router.post('/wholesale/apply', authLimiter, validate(applySchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await applyForWholesale(req.body, sessionOf(req)) });
}));

// v11 phase 8.2c (start plan §7): the «هدیهٔ سازمانی» form makes a CRM lead; the same tight limit per buyer address
const giftSchema = z.object({
  body: z.object({
    organization: z.string().max(300), contactName: z.string().max(200), phone: z.string().max(40),
    quantity: z.number().int().optional(), budget: z.string().max(40).optional(), neededBy: z.string().max(20).optional(), note: z.string().max(2000).optional(),
  }).strict(),
});

router.post('/inquiries/corporate-gift', authLimiter, validate(giftSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await submitCorporateGift(req.body) });
}));

// v12 phase 10f (start plan §7.2 «۱۰و»): a visitor's answers to a form of «فرم‌های سایت» become a message of «پیام‌های
// سایت». One visitor address tries a few sends a minute (a count of its own: a form refused field by field does not
// use up sign-in's) and has a few messages taken an hour, well under what the site as a whole sends an hour, so one
// address cannot close the forms to everyone (review of #505, M2). A request that does not name its visitor (the site
// without STOREFRONT_TRUST_PROXY) is not counted per visitor, else every visitor would share one budget; the site's
// own hourly cap stands. The schema only bounds what a request may carry; the service checks each answer against its
// field (`checkedAnswers`).
const namesNoVisitor = (req: Request) => !net.isIP(String(req.headers['x-storefront-client-ip'] ?? '').trim());
const formTryLimiter = rateLimit({
  windowMs: 60_000, max: MESSAGE_TRIES_PER_MINUTE, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `storefront-form-try:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
const formVisitorLimiter = rateLimit({
  windowMs: 3_600_000, max: MESSAGES_PER_VISITOR_HOUR, standardHeaders: true, legacyHeaders: false, skipFailedRequests: true, skip: namesNoVisitor,
  keyGenerator: (req) => `storefront-form-sent:${ipKeyGenerator(buyerAddress(req))}`,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
const formSubmitSchema = z.object({
  params: z.object({ key: z.string().min(1).max(FORM_KEY_MAX).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }).passthrough(),
  body: z.object({
    requestKey: z.string().max(80), formStamp: z.string().regex(FORM_STAMP),
    // each value is bounded by itself, so the whole is (a count of the JSON's letters would refuse a long text of quotes or line breaks the rules take)
    answers: z.record(z.string().max(12), z.union([z.string().max(8000), z.boolean(), z.array(z.string().max(200)).max(20)]))
      .refine(value => Object.keys(value).length <= FORM_FIELDS_MAX * 2, 'پاسخ‌های فرم بیش از اندازه بزرگ هستند.'),
  }).strict(),
});

router.post('/forms/:key/submit', formTryLimiter, formVisitorLimiter, validate(formSubmitSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await submitFormAnswers(String(req.params.key), req.body) });
}));

router.get('/account', asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await myAccount(sessionOf(req)) });
}));

router.get('/account/prices', asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await myGroupPrices(sessionOf(req)) });
}));

// v11 phase 8.2b part 2: the account's own orders, and a guest order joining it with its tracking key
const accountOrdersSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
  }).strict(),
});
const claimSchema = z.object({ body: z.object({ number: z.string().max(20), accessKey: z.string().max(ACCESS_KEY_MAX + 1) }).strict() });

router.get('/account/orders', validate(accountOrdersSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number };
  res.json({ data: await myOrders(sessionOf(req), { page: query.page ?? 1, limit: query.limit ?? 20 }) });
}));

router.get('/account/orders/:number', validate(orderReadSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await myOrder(sessionOf(req), String(req.params.number)) });
}));

router.post('/account/orders/:number/receipts', writeLimiter, validate(receiptSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ data: await sendAccountReceipt(sessionOf(req), String(req.params.number), req.body) });
}));

router.post('/account/orders/claim', writeLimiter, validate(claimSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await claimOrder(sessionOf(req), req.body) });
}));

// v12 phase 8c: the account's address book (kept from the checkout; listed, made the default and removed from «حساب من»)
const addressSchema = z.object({ params: z.object({ id: z.string().regex(/^[1-9]\d{0,9}$/) }).strict() });
const addressDefaultSchema = addressSchema.extend({ body: z.object({}).strict().optional() });

router.get('/account/addresses', asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await myAddresses(sessionOf(req)) });
}));

router.post('/account/addresses/:id/default', writeLimiter, validate(addressDefaultSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await setDefaultAddress(sessionOf(req), Number(req.params.id)) });
}));

router.delete('/account/addresses/:id', writeLimiter, validate(addressSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await removeAddress(sessionOf(req), Number(req.params.id)) });
}));

export default router;
