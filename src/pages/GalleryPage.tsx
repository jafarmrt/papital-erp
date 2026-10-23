import { useEffect, useEffectEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { User } from '../types';
import { Search, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn, errorMessageOf, formatPersianNumber, formatPersianPrice } from '../utils';
import { SafeImage } from '../components/SafeImage';
import { useSearch } from '../SearchContext';
import { DialogLayer } from '../components/common/DialogLayer';
import { useOpeningRead } from '../hooks/queries/readOnEveryOpening';
import { useGalleryItemsQuery } from '../hooks/queries/useItemQueries';
import { useCategoriesQuery } from '../hooks/queries/useSettingsQueries';

export default function GalleryPage({ user }: { user: User }) {
  const { searchQuery: search, setSearchQuery: setSearch, debouncedSearchQuery: debouncedSearch } = useSearch();
  const [tab, setTab] = useState<'product'|'raw_material'>('product');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // a new search, tab or category starts at its first page (in the same render, so the old page is never read for it)
  const filterKey = JSON.stringify([tab, debouncedSearch, selectedCategory]);
  const [paging, setPaging] = useState({ of: filterKey, page: 1 });
  const currentPage = paging.of === filterKey ? paging.page : 1;
  const setCurrentPage = (page: number) => setPaging({ of: filterKey, page });

  // v10.1.51 (OBS-R2-62): one server page at a time (it read every item of the type at once, with its stock and reservations)
  // 10.3 (ARCH review finding 3, part 16): the page and the categories read through the shared cache, again on each
  // visit and never shown from an earlier one; an item save or a stock change refreshes the page on screen
  const itemsRead = useOpeningRead(useGalleryItemsQuery({ tab, page: currentPage, search: debouncedSearch, category: selectedCategory }), true);
  const categoriesRead = useOpeningRead(useCategoriesQuery(undefined, { readOnEveryOpening: true }), true);
  const categories = categoriesRead.data ?? [];
  const itemsError = itemsRead.data === undefined && itemsRead.error
    ? errorMessageOf(itemsRead.error) || 'تصاویر گالری کالاها خوانده نشد؛ صفحه را دوباره باز کنید.'
    : '';
  const isLoading = itemsRead.data === undefined && !itemsError;
  // the page count of the last page shown stays while the next one is read
  const [totalPages, setTotalPages] = useState(1);
  if (itemsRead.data && itemsRead.data.totalPages !== totalPages) setTotalPages(itemsRead.data.totalPages);

  const sayCategoriesFailed = useEffectEvent(() => { toast.error('خطا در دریافت دسته‌بندی‌ها'); });
  useEffect(() => {
    if (categoriesRead.failedAt) sayCategoriesFailed();
  }, [categoriesRead.failedAt]);

  const paginatedItems = itemsRead.data?.rows ?? [];

  return (
    <div className="flex flex-col h-full bg-slate-50/50 space-y-6 p-4 md:p-6 max-w-[1700px] mx-auto text-right font-farsi">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-amber-400 shadow-inner shrink-0">
              <ImageIcon size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                گالری تصویری و آلبوم اقلام انبار
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                مرور دیداری تمامی محصولات نهایی و مواد اولیه همراه با تصاویر با کیفیت و کدهای کالا
              </p>
            </div>
          </div>
          
          <div className="flex bg-slate-800/80 backdrop-blur-xs p-1 rounded-xl border border-slate-700/80 shrink-0">
            <button 
              onClick={() => setTab('product')} 
              className={cn("px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer", tab === 'product' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white")}
            >
              محصولات نهایی
            </button>
            <button 
              onClick={() => setTab('raw_material')} 
              className={cn("px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer", tab === 'raw_material' ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-slate-300 hover:text-white")}
            >
              مواد اولیه
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 bg-slate-50 border-b flex justify-between items-center gap-4 shrink-0">
        <div className="flex items-center gap-2 w-full max-w-2xl">
          <div className="relative w-full max-w-sm">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="جست‌وجو نام، کد یا دسته‌بندی..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-10 py-1.5 rounded border text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-48 py-1.5 px-3 rounded border text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
          >
            <option value="">همه دسته‌بندی‌ها</option>
            {categories.filter(c => c.type === tab).length === 0 && <option disabled>دسته بندی یافت نشد</option>}
            {categories.filter(c => c.type === tab).map((c, idx) => (
              <option key={`cat-gal-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 bg-slate-100">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {!isLoading && paginatedItems.map((item, idx) => {
            const stock = Number(item.current_stock || 0);
            const wacVal = Number(item.weighted_average_cost ?? (item as any).weightedAverageCost ?? 0);
            const itemCurrency = (item as any).currency as string | undefined;
            const stockBadgeCls = stock > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200';
            return (
            <div key={`gal-card-${item.id || idx}-${idx}`} className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col hover:shadow-md transition-shadow group relative">
              <button onClick={() => setLightboxImage(item.image || item.thumbnail || null)} className="aspect-square w-full bg-slate-50 flex items-center justify-center p-2 relative overflow-hidden cursor-zoom-in">
                <SafeImage src={item.image || item.thumbnail} alt={item.name} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" fallbackIcon={<ImageIcon size={28} />} />
              </button>
              <div className="p-3 bg-white flex flex-col gap-1 border-t">
                <div className="font-bold text-sm text-slate-800 line-clamp-1" title={item.name}>{item.name}</div>
                <div className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded mr-auto select-all">{item.code}</div>
                <div className="text-[10px] text-slate-400">{item.category || 'بدون دسته'}</div>
                {/* V10-2.3: badge موجودی + میانگین موزون بهای تمام‌شده (WAC) */}
                <div className="flex items-center justify-between gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${stockBadgeCls}`} title="موجودی فعلی">
                    موجودی: {formatPersianNumber(stock)} {item.unit || ''}
                  </span>
                  <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md truncate" title="میانگین موزون بهای تمام‌شده">
                    میانگین خرید: {formatPersianPrice(wacVal, itemCurrency)}
                  </span>
                </div>
              </div>
            </div>
            );
          })}
          
          {isLoading && (
            <div role="status" className="col-span-full py-20 text-center text-slate-500 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" aria-hidden="true" />
              <div>در حال بارگذاری تصاویر گالری…</div>
            </div>
          )}

          {itemsError && (
            <div role="alert" className="col-span-full py-20 text-center text-rose-600">{itemsError}</div>
          )}

          {!isLoading && !itemsError && paginatedItems.length === 0 && (
            <div className="col-span-full py-20 text-center text-slate-500 flex flex-col items-center">
              <div className="text-4xl mb-4">🖼️</div>
              <div>موردی برای نمایش در گالری یافت نشد. باید برای کالاها تصویر بارگذاری کنید.</div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button 
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded border bg-white disabled:opacity-50 text-sm shadow-sm"
            >
              قبلی
            </button>
            <span className="text-sm font-bold mx-2">
              صفحه {formatPersianNumber(currentPage)} از {formatPersianNumber(totalPages)}
            </span>
            <button 
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded border bg-white disabled:opacity-50 text-sm shadow-sm"
            >
              بعدی
            </button>
          </div>
        )}
      </div>

      {lightboxImage && (
        <div role="dialog" aria-modal="true" aria-label="نمایش تصویر" className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 backdrop-blur-sm cursor-zoom-out" onClick={() => setLightboxImage(null)}>
          <DialogLayer onClose={() => setLightboxImage(null)} />
          <button aria-label="بستن" onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-full transition-colors z-[110]">
             <X size={32} />
          </button>
          <img src={lightboxImage} alt="گالری" className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl cursor-default" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
