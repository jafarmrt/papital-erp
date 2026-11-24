import type { Ref } from 'react';
import type { PageKind } from '../../../lib/storefront/storefrontPageRules';

/**
 * The question before «برگرداندن», «برداشتن از روی سایت» and «حذف صفحه» in the page editor (v12 phase 10b; moved out of
 * `PageEditor.tsx` in 10c). The words of «برداشتن» go by the page's kind: a page the shop made leaves the site, a base
 * page goes back to the text in the site's code, and a fixed page stays where it is and only loses the words written
 * here. The question takes the focus when it opens (the editor does that through `ref`).
 */
export function PageActionConfirm({ ref, asking, kind, dirty, linkedFrom, linkedCollections = [], busy, onYes, onNo }: {
  ref: Ref<HTMLDivElement>;
  asking: 'revert' | 'unpublish' | 'delete';
  kind: PageKind;
  dirty: boolean;
  /** the menus that link to the page, as a phrase ('' = none) */
  linkedFrom: string;
  /** v12 phase 10e: the collections whose «آشنایی بیشتر» leads to the page */
  linkedCollections?: readonly string[];
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label="تأیید این کار" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="min-w-0 flex-1">
        {asking === 'revert' && 'تغییرهای پیش‌نویس دور ریخته می‌شود و پیش‌نویس همان نسخهٔ روی سایت می‌شود.'}
        {asking === 'unpublish' && kind === 'fixed' && 'متنی که این‌جا برای این صفحه نوشته شده از روی سایت برداشته می‌شود. خود صفحه سر جایش می‌ماند و متن خودش را نشان می‌دهد. پیش‌نویس می‌ماند.'}
        {asking === 'unpublish' && kind !== 'fixed' && (kind === 'base' ? 'این صفحه از روی سایت برداشته می‌شود و سایت متن ثابت پیشین خودش را برای آن نشان می‌دهد. پیش‌نویس می‌ماند.' : 'این صفحه از روی سایت برداشته می‌شود و نشانی‌اش «پیدا نشد» می‌شود. پیش‌نویس می‌ماند.')}
        {asking === 'delete' && `این صفحه حذف می‌شود و اگر روی سایت باشد از آن‌جا هم برداشته می‌شود.${dirty ? ' تغییرهای ذخیره‌نشدهٔ آن هم از میان می‌رود.' : ''}`}
        {/* v12 phase 10c: the menus that link to this page lose that link on the site (10c review: nothing said so) */}
        {(asking === 'delete' || asking === 'unpublish') && linkedFrom && (
          <span data-menu-warning className="mt-1 block font-bold">
            {asking === 'delete'
              ? `این صفحه در ${linkedFrom} پیوند دارد. آن پیوند دیگر روی سایت نمی‌آید؛ پس از حذف، آن گزینه را در «فهرست‌های سایت» بردارید یا به صفحهٔ دیگری بدهید.`
              : `این صفحه در ${linkedFrom} پیوند دارد. تا انتشار دوباره، آن پیوند روی سایت نمی‌آید.`}
          </span>
        )}
        {(asking === 'delete' || asking === 'unpublish') && linkedCollections.length > 0 && (
          <span data-collection-warning className="mt-1 block font-bold">
            {`پیوند «آشنایی بیشتر» ${linkedCollections.map(name => `کالکشن «${name}»`).join(' و ')} به این صفحه می‌آید و ${asking === 'delete' ? 'دیگر روی سایت نشان داده نمی‌شود؛ پس از حذف، در «کالکشن‌های سایت» صفحهٔ دیگری برایش برگزینید' : 'تا انتشار دوباره روی سایت نشان داده نمی‌شود'}.`}
          </span>
        )}
      </p>
      <button type="button" disabled={busy} onClick={onYes} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">بله، انجام شود</button>
      <button type="button" onClick={onNo} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
    </div>
  );
}
