import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Images } from 'lucide-react';
import { isAbortError } from '../api';
import { formatPersianNumber } from '../utils';
import { MediaProductFiltersBar } from '../components/media/MediaProductFiltersBar';
import { MediaPager, MediaProductCard } from '../components/media/MediaProductCard';
import {
  getMediaProductFilters, listMediaProducts, mediaErrorMessage, mediaProductQueryFrom, mediaProductQueryParams,
  type MediaProductFilterOptions, type MediaProductPage, type MediaProductQuery,
} from '../lib/media/mediaApi';

export const MEDIA_LIBRARY_TITLE = 'کتابخانه تصاویر و فیلم‌ها';

/** v10.0.25 (N-05 PR 2): the media library's product grid; search conditions live in the page address */
export default function MediaLibraryPage() {
  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  const query = useMemo(() => mediaProductQueryFrom(new URLSearchParams(paramsText)), [paramsText]);
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

  const changeQuery = useCallback((next: MediaProductQuery) => {
    setParams(mediaProductQueryParams(next), { replace: true });
  }, [setParams]);

  const rows = result?.data ?? [];

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Images size={20} /></div>
        <div>
          <h1 className="text-lg font-black text-slate-800">{MEDIA_LIBRARY_TITLE}</h1>
          <p className="text-xs text-slate-500">
            {result ? `${formatPersianNumber(result.total)} محصول` : 'تصویرها و فیلم‌های محصولات'}
          </p>
        </div>
      </header>

      <MediaProductFiltersBar query={query} options={options} onChange={changeQuery} />

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

      {result && <MediaPager page={result.page || query.page} total={result.total} limit={result.limit} onPage={p => changeQuery({ ...query, page: p })} />}
    </div>
  );
}
