import type { RequestHandler } from 'express';
import { withUtcTimestampKeys } from '../lib/serverTimestamp.js';

/**
 * v9.0.436 (TD-725، B15-23): هر پاسخ JSON مسیرهای پس از این میان‌افزار، زمان‌های سرور کلیدهای `keys` را با Z می‌فرستد
 * (AGENTS §1.10)؛ مرورگر زمان بی‌منطقه را ساعت منطقه توافقی می‌خواند و آن را ۳٫۵ ساعت زودتر نشان می‌داد.
 */
export function utcTimestampResponses(keys: ReadonlySet<string>, opaqueKeys?: ReadonlySet<string>): RequestHandler {
  return (_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: unknown) => json(withUtcTimestampKeys(body, keys, opaqueKeys));
    next();
  };
}
