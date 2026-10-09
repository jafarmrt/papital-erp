import { useEffect, useState } from 'react';
import { isAbortError } from '../../api';
import { formatPersianNumber } from '../../utils';
import { MediaProductFiltersBar } from './MediaProductFiltersBar';
import { MediaPager, MediaProductCard } from './MediaProductCard';
import {
  getMediaProductFilters, listMediaProducts, mediaErrorMessage,
  type MediaProductFilterOptions, type MediaProductPage, type MediaProductQuery,
} from '../../lib/media/mediaApi';

interface Props {
  query: MediaProductQuery;
  onQuery: (next: MediaProductQuery) => void;
}

/** v10.0.25 (N-05 PR 2), moved out of the page in v10.0.27 (N-05 PR 3): the product grid of the «محصولات» section */
export function MediaProductsGrid({ query, onQuery }: Props) {
  const [result, setResult] = useState<MediaProductPage | null>(null);
  const [options, setOptions] = useState<MediaProductFilterOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getMediaProductFilters(controller.signal)
      .then(setOptions)
      .catch((err: unknown) => {
        if (!isAbortError(err)) setOptions(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listMediaProducts(query, controller.signal)
      .then(res => {
        setResult({ ...res, data: Array.isArray(res?.data) ? res.data : [] });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(mediaErrorMessage(err, 'دریافت فهرست محصولات ناموفق بود.'));
        setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  const rows = result?.data ?? [];

  return (
    <div className="space-y-4">
      {result && <p className="text-xs text-slate-500">{formatPersianNumber(result.total)} محصول</p>}
      <MediaProductFiltersBar query={query} options={options} onChange={onQuery} />

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {loading && !result ? (
        <div className="py-16 text-center text-sm text-slate-400">در حال بارگذاری...</div>
      ) : rows.length === 0 && !error ? (
        <div className="py-16 text-center text-sm text-slate-500">محصولی با این شرط‌ها یافت نشد.</div>
      ) : (
        <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3 ${loading ? 'opacity-60' : ''}`}>
          {rows.map(row => <MediaProductCard key={row.itemId} row={row} />)}
        </div>
      )}

      {result && <MediaPager page={result.page || query.page} total={result.total} limit={result.limit} onPage={p => onQuery({ ...query, page: p })} />}
    </div>
  );
}
