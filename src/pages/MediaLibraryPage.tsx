import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Images } from 'lucide-react';
import { useHasAnyPermission, useHasPermission } from '../contexts/AuthContext';
import type { User } from '../types';
import { MediaProductsGrid } from '../components/media/MediaProductsGrid';
import { MediaSectionTabs } from '../components/media/MediaSectionTabs';
import { MediaSectionsModal } from '../components/media/MediaSectionsModal';
import { MediaSectionView } from '../components/media/MediaSectionView';
import { useMediaSections } from '../components/media/useMediaSections';
import { mediaProductQueryFrom, mediaProductQueryParams, type MediaProductQuery } from '../lib/media/mediaApi';
import { MEDIA_MANAGE_KEY, MEDIA_UPLOAD_KEYS } from '../lib/media/mediaAccess';
import {
  EMPTY_SECTION_QUERY, mediaSectionQueryFrom, mediaSectionQueryParams, sectionIdFrom, type MediaSection, type MediaSectionQuery,
} from '../lib/media/mediaSectionsApi';

export const MEDIA_LIBRARY_TITLE = 'کتابخانه تصاویر و فیلم‌ها';
export const SECTION_NOT_FOUND_TEXT = 'این بخش یافت نشد؛ شاید حذف شده باشد.';

/**
 * v10.0.25 (N-05 PR 2): the media library; v10.0.27 (N-05 PR 3) adds its sections. «محصولات» shows the product grid,
 * a custom section its files. The chosen section and its search conditions live in the page address (`?section=`).
 */
export default function MediaLibraryPage({ user }: { user?: User | null }) {
  const [params, setParams] = useSearchParams();
  const paramsText = params.toString();
  const canUpload = useHasAnyPermission(MEDIA_UPLOAD_KEYS);
  const canManage = useHasPermission(MEDIA_MANAGE_KEY);
  const { sections, error: sectionsError, reload, replace } = useMediaSections();
  const [managing, setManaging] = useState(false);

  const sectionId = useMemo(() => sectionIdFrom(new URLSearchParams(paramsText)), [paramsText]);
  const productQuery = useMemo(() => mediaProductQueryFrom(new URLSearchParams(paramsText)), [paramsText]);
  const sectionQuery = useMemo(() => mediaSectionQueryFrom(new URLSearchParams(paramsText)), [paramsText]);

  const list = sections ?? [];
  const chosen = sectionId === null ? null : list.find(s => s.id === sectionId) ?? null;
  const productsSection = list.find(s => s.kind === 'products') ?? null;
  const showProducts = sectionId === null || chosen?.kind === 'products';
  const activeId = showProducts ? productsSection?.id ?? null : chosen?.id ?? null;

  const changeProductQuery = useCallback((next: MediaProductQuery) => {
    setParams(mediaProductQueryParams(next), { replace: true });
  }, [setParams]);
  const changeSectionQuery = useCallback((next: MediaSectionQuery) => {
    if (sectionId !== null) setParams(mediaSectionQueryParams(sectionId, next), { replace: true });
  }, [sectionId, setParams]);
  const select = useCallback((section: MediaSection) => {
    setParams(section.kind === 'products' ? new URLSearchParams() : mediaSectionQueryParams(section.id, EMPTY_SECTION_QUERY));
  }, [setParams]);

  const rights = { canUpload, canManage, username: user?.username };

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Images size={20} /></div>
        <div>
          <h1 className="text-lg font-black text-slate-800">{MEDIA_LIBRARY_TITLE}</h1>
          <p className="text-xs text-slate-500">{chosen && !showProducts ? chosen.title : 'تصویرها و فیلم‌های محصولات و بخش‌های دیگر'}</p>
        </div>
      </header>

      {sections && <MediaSectionTabs sections={list} activeId={activeId} canManage={canManage} onSelect={select} onManage={() => setManaging(true)} />}
      {sectionsError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{sectionsError}</div>}

      {showProducts ? (
        <MediaProductsGrid query={productQuery} onQuery={changeProductQuery} />
      ) : chosen ? (
        <MediaSectionView key={chosen.id} section={chosen} query={sectionQuery} rights={rights} onQuery={changeSectionQuery} onCountChanged={reload} />
      ) : sections ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{SECTION_NOT_FOUND_TEXT}</div>
      ) : !sectionsError && (
        <div className="py-16 text-center text-sm text-slate-400">در حال بارگذاری...</div>
      )}

      {managing && canManage && sections && (
        <MediaSectionsModal sections={list} onClose={() => setManaging(false)} onReplace={replace} onReload={reload} />
      )}
    </div>
  );
}
