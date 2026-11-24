import { LayoutTemplate } from 'lucide-react';
import {
  COLLECTION_INTROS_MAX, HOME_KINDS_ONCE, HOME_KINDS_WITH_BACKGROUND, SECTION_KINDS, isHomeSectionKind, todayHomeSections, type PageSection, type SectionKind,
} from '../../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10e: two small parts the page builder shows only for «صفحهٔ اصلی»: the switch that takes one part off the
 * site without losing its words, and the start from the home page the site has today.
 */
/** a part of the home page whose look is the site's own takes no ground */
export const ownLook = (section: PageSection): boolean => isHomeSectionKind(section.kind) && !HOME_KINDS_WITH_BACKGROUND.includes(section.kind);

/** The kinds the home page can still take: every kind but the delivery table, and a part that comes once only while it is not there */
export const homeKinds = (sections: readonly PageSection[]): SectionKind[] => SECTION_KINDS.filter(kind => (
  kind !== 'shippingMethods' && !(isHomeSectionKind(kind) && HOME_KINDS_ONCE.includes(kind) && sections.some(section => section.kind === kind))
  && !(kind === 'collectionIntro' && sections.filter(section => section.kind === 'collectionIntro').length >= COLLECTION_INTROS_MAX)
));

export function SectionSwitch({ name, hidden, onChange }: { name: string; hidden: boolean; onChange: (hidden: boolean) => void }) {
  return (
    <label className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${hidden ? 'bg-amber-50 text-amber-800' : 'text-slate-700'}`}>
      <input type="checkbox" checked={!hidden} aria-label={`${name}: روی سایت نشان داده شود`} onChange={e => onChange(!e.target.checked)} />
      {hidden ? 'خاموش است' : 'روشن'}
    </label>
  );
}

export function HomeStart({ onStart }: { onStart: (sections: PageSection[]) => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5">
      <p className="text-xs leading-6 text-slate-600">
        صفحهٔ اصلی هنوز بخشی ندارد. می‌توانید از صفحهٔ اصلی امروز سایت شروع کنید: همان بخش‌ها با همان نوشته‌ها می‌آیند و بعد هر کدام را عوض، جابه‌جا یا خاموش می‌کنید و اسلایدر و بنر می‌افزایید. یا از پایین بخش‌ها را یکی‌یکی بیفزایید.
      </p>
      <button type="button" onClick={() => onStart(todayHomeSections())} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
        <LayoutTemplate className="h-4 w-4" />
        شروع از صفحهٔ اصلی امروز
      </button>
    </div>
  );
}
