import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { faNumber } from '../lib/format';

/** Plain links, so every page of a list has its own address (and works without JavaScript) */
export function Pagination({ page, pages, hrefOf }: { page: number; pages: number; hrefOf: (page: number) => string }) {
  if (pages <= 1) return null;
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 1);
  const cell = 'flex size-11 items-center justify-center rounded-control border border-border';
  return (
    <nav className="mt-12 flex items-center justify-center gap-2" aria-label="صفحه‌ها">
      {page > 1 ? <Link to={hrefOf(page - 1)} className={cell} aria-label="صفحهٔ قبل"><ChevronRight className="size-5" aria-hidden /></Link> : null}
      {numbers.map((n, i) => (
        <span key={n} className="flex items-center gap-2">
          {i > 0 && n - numbers[i - 1] > 1 ? <span className="text-muted-foreground" aria-hidden>…</span> : null}
          {n === page
            ? <span className={`${cell} bg-primary font-bold text-primary-foreground`} aria-current="page">{faNumber(n)}</span>
            : <Link to={hrefOf(n)} className={`${cell} bg-card hover:bg-muted`}>{faNumber(n)}</Link>}
        </span>
      ))}
      {page < pages ? <Link to={hrefOf(page + 1)} className={cell} aria-label="صفحهٔ بعد"><ChevronLeft className="size-5" aria-hidden /></Link> : null}
    </nav>
  );
}
