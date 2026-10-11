import type { CSSProperties } from 'react';

/** پهنای منوی «⋮» (w-44) و ارتفاع تخمینی هر گزینه */
export const ACTION_MENU_WIDTH = 176;
export const ACTION_MENU_ITEM_HEIGHT = 34;
const GAP = 4;
const EDGE = 8;

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * v10.0.x (TD-1238): جای منوی ثابت «⋮» نسبت به دکمه‌اش. منو زیر دکمه باز می‌شود و
 * اگر تا پایین صفحه جا نباشد بالای آن؛ لبه‌هایش درون پهنای صفحه می‌ماند.
 */
export function actionMenuPosition(
  trigger: TriggerRect,
  itemCount: number,
  align: 'left' | 'right',
  viewport: { width: number; height: number },
): CSSProperties {
  const height = itemCount * ACTION_MENU_ITEM_HEIGHT + 2 * GAP;
  const wanted = align === 'right' ? trigger.right - ACTION_MENU_WIDTH : trigger.left;
  const left = Math.max(EDGE, Math.min(wanted, viewport.width - ACTION_MENU_WIDTH - EDGE));
  const below = trigger.bottom + GAP;
  if (below + height <= viewport.height - EDGE || trigger.top - GAP - height < EDGE) {
    return { left, top: below };
  }
  return { left, bottom: viewport.height - trigger.top + GAP };
}
