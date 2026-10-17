import { ArrowDown, ArrowUp, ImageUp, RefreshCw } from 'lucide-react';
import type { MediaAssetView } from '../../lib/media/mediaApi';

export const MOVE_EARLIER_TEXT = 'جابه‌جایی به قبل';
export const MOVE_LATER_TEXT = 'جابه‌جایی به بعد';
export const REPLACE_TEXT = 'جایگزینی با نسخه بهتر';
/** v10.1.70: the item's picture is the product's one featured image, so the library sets it instead of its own cover */
export const ITEM_IMAGE_TEXT = 'تصویر شاخص محصول شود';

/** What one tile may do besides download, edit and delete; each flag follows the key its route asks */
export interface MediaTileExtraFlags {
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  canReplace: boolean;
  canItemImage: boolean;
}

interface Props {
  asset: MediaAssetView;
  flags: MediaTileExtraFlags;
  busy: boolean;
  onMove: (step: -1 | 1) => void;
  onReplace: () => void;
  onItemImage: () => void;
}

const actionClass = 'inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40';

/** v10.0.247 (N-05 PR 3): order, replacement and featured-image buttons of a gallery tile */
export function MediaAssetTileActions({ asset, flags, busy, onMove, onReplace, onItemImage }: Props) {
  const name = asset.title || asset.originalName;
  return (
    <>
      {flags.canMoveEarlier && (
        <button type="button" disabled={busy} onClick={() => onMove(-1)} className={actionClass} aria-label={`${MOVE_EARLIER_TEXT} ${name}`} title={MOVE_EARLIER_TEXT}>
          <ArrowUp size={12} />
        </button>
      )}
      {flags.canMoveLater && (
        <button type="button" disabled={busy} onClick={() => onMove(1)} className={actionClass} aria-label={`${MOVE_LATER_TEXT} ${name}`} title={MOVE_LATER_TEXT}>
          <ArrowDown size={12} />
        </button>
      )}
      {flags.canReplace && (
        <button type="button" disabled={busy} onClick={onReplace} className={actionClass}><RefreshCw size={12} /> {REPLACE_TEXT}</button>
      )}
      {flags.canItemImage && (
        <button type="button" disabled={busy} onClick={onItemImage} className={actionClass}><ImageUp size={12} /> {ITEM_IMAGE_TEXT}</button>
      )}
    </>
  );
}
