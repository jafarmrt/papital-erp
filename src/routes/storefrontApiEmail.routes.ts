import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { PASSWORD_MAX } from '../lib/storefront/storefrontBuyerRules.js';
import { EMAIL_ADDRESS_MAX, EMAIL_PROOF_MAX } from '../lib/storefront/storefrontEmailRules.js';
import { PHONE_PROOF_MAX } from '../lib/storefront/storefrontSmsRules.js';
import { requestEmailCode, verifyEmailCode } from '../services/storefront/storefrontEmailOtp.service.js';
import { emailSignIn, resetPassword, setAccountEmail, setAccountPhone } from '../services/storefront/storefrontBuyerEmail.service.js';

/**
 * v12 phase 8e (start plan §5, owner's decision 7): the email routes of the Storefront API, mounted inside its router
 * (`storefrontApi.routes.ts`), so the site's key, the site switch and the shared limits stand in front of every one:
 * the email code and its proof, the sign-in by email, a forgotten password (by an SMS or an email code), and a proven
 * email or phone added to a signed-in account. Every route answers only the buyer's own data.
 */
export interface EmailRouteDeps {
  writeLimiter: RequestHandler;
  authLimiter: RequestHandler;
  otpLimiter: RequestHandler;
  buyerAddress: (req: Request) => string;
  sessionOf: (req: Request) => string;
}

const email = z.string().max(EMAIL_ADDRESS_MAX + 6);
const emailProof = z.string().max(EMAIL_PROOF_MAX + 1);
const phoneProof = z.string().max(PHONE_PROOF_MAX + 1);
const password = z.string().max(PASSWORD_MAX * 2);

const codeRequestSchema = z.object({ body: z.object({ email }).strict() });
const codeVerifySchema = z.object({ body: z.object({ email, code: z.string().max(20) }).strict() });
const emailLoginSchema = z.object({ body: z.object({ email, emailProof }).strict() });
const resetSchema = z.object({
  body: z.union([
    z.object({ phone: z.string().max(40), phoneProof, password }).strict(),
    z.object({ email, emailProof, password }).strict(),
  ]),
});
const accountEmailSchema = z.object({ body: z.object({ email, emailProof }).strict() });
const accountPhoneSchema = z.object({ body: z.object({ phone: z.string().max(40), phoneProof }).strict() });

export function storefrontEmailRoutes(deps: EmailRouteDeps): Router {
  const router = Router();
  const { writeLimiter, authLimiter, otpLimiter, buyerAddress, sessionOf } = deps;

  router.post('/auth/email-code/request', writeLimiter, otpLimiter, validate(codeRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await requestEmailCode(req.body.email, buyerAddress(req)) });
  }));

  router.post('/auth/email-code/verify', writeLimiter, validate(codeVerifySchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await verifyEmailCode(req.body.email, req.body.code) });
  }));

  router.post('/auth/email-login', authLimiter, validate(emailLoginSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await emailSignIn(req.body) });
  }));

  router.post('/auth/reset-password', authLimiter, validate(resetSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await resetPassword(req.body) });
  }));

  router.post('/account/email', authLimiter, validate(accountEmailSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await setAccountEmail(sessionOf(req), req.body) });
  }));

  router.post('/account/phone', authLimiter, validate(accountPhoneSchema), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await setAccountPhone(sessionOf(req), req.body) });
  }));

  return router;
}
