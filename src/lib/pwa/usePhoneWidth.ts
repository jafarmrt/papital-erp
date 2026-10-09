import { useEffect, useState } from 'react';

/** پهنای گوشی: کمتر از ۷۶۸ پیکسل، همان مرز md که نوار پایین و منوی کناری با آن جابه‌جا می‌شوند */
export const PHONE_WIDTH_QUERY = '(max-width: 767.98px)';

function phoneMatch(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_WIDTH_QUERY) : null;
}

/**
 * v10.0.19 (D-11): آیا صفحه پهنای گوشی دارد؛ صفحه‌ای که روی گوشی چیدمان دیگری دارد فقط یکی از دو چیدمان را می‌سازد
 * تا هر خانه ورودی یک بار در صفحه باشد. بی matchMedia (چاپ یا مرورگر قدیمی) چیدمان رایانه است.
 */
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(() => phoneMatch()?.matches ?? false);
  useEffect(() => {
    const query = phoneMatch();
    if (!query) return undefined;
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}
