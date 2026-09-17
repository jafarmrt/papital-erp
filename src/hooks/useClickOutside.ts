import { useEffect, useRef, type RefObject } from 'react';

/**
 * هوک مشترک بستن منو/دراپ‌داون با کلیک بیرون (v4.0.29 — تلفیق ۴ کپی تکراری).
 * @param refs عناصری که کلیک داخل آن‌ها «بیرون» محسوب نمی‌شود
 * @param onOutside کالبک اجرای هنگام کلیک بیرون از همه عناصر
 * @param active فعال‌بودن شنونده (مثلاً فقط وقتی منو باز است)
 */
export function useClickOutside<T extends HTMLElement>(
  refs: Array<RefObject<T | null>>,
  onOutside: () => void,
  active: boolean = true
): void {
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!active) return;
    function handler(event: MouseEvent) {
      const target = event.target as Node;
      const inside = refsRef.current.some(r => r.current && r.current.contains(target));
      if (!inside) {
        cbRef.current();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active]);
}
