/**
 * v10.0.16 (D-11): وضعیت برنامه نصب‌پذیر برای نوارهای پوسته. service worker وقتی نسخه تازه را آماده کند `markUpdateReady`
 * را با تابع جایگزینی صدا می‌زند؛ نوار «نسخه تازه آماده است» با دکمه «بارگذاری دوباره» همان تابع را اجرا می‌کند. نسخه تازه
 * هرگز بی‌صدا جای نسخه باز را نمی‌گیرد، چون صفحه باز ممکن است فرمی نیمه‌کاره داشته باشد.
 */

type ApplyUpdate = () => Promise<void> | void;

let applyUpdate: ApplyUpdate | null = null;
const listeners = new Set<(ready: boolean) => void>();

export function markUpdateReady(apply: ApplyUpdate): void {
  applyUpdate = apply;
  listeners.forEach(listener => listener(true));
}

export function isUpdateReady(): boolean {
  return applyUpdate !== null;
}

export function subscribeUpdateReady(listener: (ready: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** نسخه تازه را جایگزین می‌کند و صفحه را دوباره بار می‌کند */
export async function applyReadyUpdate(): Promise<void> {
  const apply = applyUpdate;
  if (!apply) return;
  await apply();
}

/** فقط برای آزمون‌ها */
export function resetPwaStatusForTests(): void {
  applyUpdate = null;
  listeners.clear();
}
