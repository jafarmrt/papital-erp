/**
 * v7.0.23 (TD-181 / audit P0-5) — تنظیم صریح اعتماد به پراکسی معکوس (Express `trust proxy`)
 * =========================================================================================
 * محدودکننده ورود قبلاً کلید خود را از آدرس سوکت می‌گرفت تا X-Forwarded-For جعلی نتواند سطل
 * محدودیت را عوض کند؛ اما پشت Nginx (setup-domain.sh) یا Ingress کوبرنتیز، آدرس سوکت برای همه
 * کاربران آدرس پراکسی است و کل سازمان یک سطل مشترک ۱۰ درخواستی داشت.
 *
 * راه‌حل: فقط به پراکسی‌های شناخته‌شده اعتماد می‌شود. Express در این حالت آدرس واقعی کلاینت را از
 * X-Forwarded-For استخراج می‌کند و هدر ارسالی از کلاینت مستقیم (غیرقابل‌اعتماد) نادیده گرفته می‌شود.
 *
 * مقدار متغیر محیطی TRUST_PROXY:
 *   - پیش‌فرض: `loopback, linklocal` — Nginx روی همان سرور و فرانت‌های link-local
 *   - فهرست با کاما از نام‌های proxy-addr (`loopback`، `linklocal`، `uniquelocal`) یا IP/CIDR
 *     مثال کوبرنتیز: `loopback, linklocal, uniquelocal`
 *   - عدد صحیح: تعداد hopهای قابل‌اعتماد (فقط وقتی همه مسیرها قطعاً از پراکسی عبور می‌کنند)
 *   - `false`: عدم اعتماد به هیچ پراکسی (اتصال مستقیم)
 * مقدار `true` (اعتماد به همه) ناامن است و پذیرفته نمی‌شود.
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal';

export type TrustProxySetting = boolean | number | string;

export function resolveTrustProxySetting(raw: string | undefined = process.env.TRUST_PROXY): TrustProxySetting {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_TRUST_PROXY;

  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  if (lower === 'true') {
    throw new Error(
      'TRUST_PROXY=true is unsafe: every client could spoof X-Forwarded-For. Use a hop count or a list of trusted proxy addresses (e.g. "loopback, linklocal, uniquelocal").'
    );
  }
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}
