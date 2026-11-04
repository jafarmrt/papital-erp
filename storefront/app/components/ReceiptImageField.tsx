import type { ChangeEvent } from 'react';

/**
 * v11 phase 8.2: the receipt's photo or screenshot. A phone photo is often several megabytes, more than the ERP takes
 * (3 MB), so with JavaScript the chosen picture is redrawn at most 1600 pixels wide as a JPEG before it is sent. Without
 * JavaScript (or where the browser cannot redraw it) the file goes as it is, and the server says so if it is too big.
 */
const SIDE_MAX = 1600;
const SHRINK_ABOVE = 1_200_000;

async function shrink(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== 'function' || typeof DataTransfer !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SIDE_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : null;
}

async function onPick(event: ChangeEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file || file.size <= SHRINK_ABOVE) return;
  try {
    const smaller = await shrink(file);
    if (!smaller || smaller.size >= file.size) return;
    const list = new DataTransfer();
    list.items.add(smaller);
    input.files = list.files;
  } catch {
    // the picture goes as it is
  }
}

export function ReceiptImageField() {
  return (
    <div className="space-y-2">
      <label htmlFor="field-image" className="block text-base font-bold">عکس رسید (اختیاری)</label>
      <input
        id="field-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void onPick(e)}
        aria-describedby="field-image-hint"
        className="block min-h-12 w-full rounded-control border border-border bg-card px-4 py-3 text-base file:me-3 file:rounded-control file:border-0 file:bg-muted file:px-3 file:py-1.5"
      />
      <p id="field-image-hint" className="text-sm leading-6 text-muted-foreground">عکس یا تصویر صفحهٔ رسید بانک؛ JPEG، PNG یا WEBP.</p>
    </div>
  );
}
