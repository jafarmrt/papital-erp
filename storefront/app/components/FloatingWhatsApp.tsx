import { useLocation } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '../lib/whatsapp';

/**
 * The pages of paying: the button never sits over a cart, a checkout or an order (start plan §7.2, 10a). The router
 * matches an address in any letter case and with a closing «/», so this does too (10a review).
 */
export function floatingButtonHiddenOn(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  return path === '/cart' || path === '/checkout' || path === '/orders' || path.startsWith('/orders/');
}

/**
 * v12 phase 10a: the floating WhatsApp button, a plain link (it works without JavaScript) with the number of «سفارش در
 * واتس‌اپ», shown only while the ERP's own switch for it is on. On a phone it sits above the bottom bar and the phone's
 * home bar (safe area); from the `md` width, where there is no bottom bar, in the page's corner.
 */
export function FloatingWhatsApp({ number }: { number: string }) {
  const { pathname } = useLocation();
  if (!number || floatingButtonHiddenOn(pathname)) return null;
  return (
    <a
      href={whatsappLink(number)}
      rel="noopener"
      data-floating-whatsapp
      aria-label="گفت‌وگو در واتس‌اپ"
      className="fixed end-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:bottom-6 md:end-6"
    >
      <MessageCircle className="size-7" strokeWidth={1.75} aria-hidden />
    </a>
  );
}
