import { Link, useLocation } from 'react-router';
import { House, LayoutGrid, Search, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react';
import { faNumber } from '../lib/format';
import { MENU_ICON_COMPONENTS, type SiteMenuItem } from '../lib/menus';

/**
 * v12 phase 8a (start plan decision 3): the bar along the bottom of a phone, as in the shops buyers know: خانه، دسته‌ها،
 * جست‌وجو، سبد (with how many items it holds, only while the site takes orders) and حساب من. Plain links, so it works
 * without JavaScript; it shows below the `md` width only and keeps clear of the phone's home bar (safe area). Fixed until
 * phase 9, which reads its buttons from the menu builder.
 * v12 phase 9c: while the ERP's «نوار پایین گوشی» is on, its 3 to 5 buttons replace these. The cart button shows only while
 * the site takes orders, with its count; the account button is «حساب من» or «ورود» by the visitor's sign-in. An address
 * outside the site is not a button here; fewer than three buttons left keeps the fixed bar.
 */
type Button = { to: string; label: string; icon: LucideIcon; active: boolean; badge?: number };

function builtButtons(menu: SiteMenuItem[], ordering: boolean, cartCount: number, signedIn: boolean, here: string): Button[] | null {
  const buttons = menu.flatMap((item): Button[] => {
    if (item.external || !item.href) return [];
    const icon = MENU_ICON_COMPONENTS[item.icon] ?? House;
    if (item.role === 'cart') return ordering ? [{ to: '/cart', label: item.label, icon, active: here === '/cart' || here === '/checkout', badge: cartCount }] : [];
    if (item.role === 'account') {
      return [{ to: signedIn ? '/account' : '/account/sign-in', label: signedIn ? 'حساب من' : 'ورود', icon, active: here.startsWith('/account') }];
    }
    const path = item.href.split(/[?#]/)[0];
    return [{ to: item.href, label: item.label, icon, active: path === here }];
  });
  return buttons.length >= 3 ? buttons.slice(0, 5) : null;
}

const COLUMNS: Readonly<Record<number, string>> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

export function BottomNav({ ordering, cartCount, signedIn, menu = null }: { ordering: boolean; cartCount: number; signedIn: boolean; menu?: SiteMenuItem[] | null }) {
  const { pathname } = useLocation();
  const fixed: Button[] = [
    { to: '/', label: 'خانه', icon: House, active: pathname === '/' },
    { to: '/categories', label: 'دسته‌ها', icon: LayoutGrid, active: pathname === '/categories' },
    { to: '/search', label: 'جست‌وجو', icon: Search, active: pathname === '/search' },
    ...(ordering ? [{ to: '/cart', label: 'سبد', icon: ShoppingBag, active: pathname === '/cart' || pathname === '/checkout', badge: cartCount }] : []),
    { to: signedIn ? '/account' : '/account/sign-in', label: signedIn ? 'حساب من' : 'ورود', icon: UserRound, active: pathname.startsWith('/account') },
  ];
  const items = (menu ? builtButtons(menu, ordering, cartCount, signedIn, pathname) : null) ?? fixed;
  return (
    <nav aria-label="پیمایش اصلی" data-bottom-nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-chrome pb-[env(safe-area-inset-bottom)] text-chrome-foreground md:hidden">
      <ul className={`grid ${COLUMNS[items.length] ?? 'grid-cols-5'}`}>
        {items.map(({ to, label, icon: Icon, active, badge }, i) => (
          <li key={`${i}-${to}`}>
            <Link
              to={to}
              aria-current={active ? 'page' : undefined}
              aria-label={badge ? `${label}، ${faNumber(badge)} کالا` : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? 'text-brand' : ''}`}
            >
              <span className="relative">
                <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                {badge ? <span aria-hidden className="absolute -top-1.5 -end-2 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-brand-foreground">{faNumber(badge)}</span> : null}
              </span>
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** room under the page for the bar, so the footer's last line is never behind it */
export const BottomNavSpace = () => <div aria-hidden className="h-[calc(3.5rem+env(safe-area-inset-bottom))] md:hidden" />;
