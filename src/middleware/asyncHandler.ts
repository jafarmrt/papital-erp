import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * هر هندلر/میدل‌ور async باید از این مسیر ثبت شود.
 * v7.0.66 (TD-229): Express 4 رد شدن Promise هندلر را نمی‌گیرد؛ رد رهاشده به unhandledRejection
 * و توقف کامل سرور (gracefulShutdown) می‌رسید. اینجا خطا به next و پاسخ خطای یکسان می‌رود.
 * نوع ورودی عمومی است تا هندلرهایی با req گسترده (AuthRequest و ...) هم بدون cast ثبت شوند.
 */
export const asyncHandler = <Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => unknown
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
};
