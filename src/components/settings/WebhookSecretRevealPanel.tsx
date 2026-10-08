import { useState } from 'react';
import { Check, Copy, Key, X } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

export interface RevealedWebhookSecret {
  name: string;
  secretKey: string;
}

/**
 * v9.0.339 (TD-710، تصمیم ت۶ الف): کلید امضای وب‌هوک فقط یک بار، پس از ساخت درگاه یا «ساخت کلید تازه»، نشان داده می‌شود؛
 * همه پاسخ‌های دیگر آن را پوشیده برمی‌گردانند.
 */
export function WebhookSecretRevealPanel({ secret, onClose }: { secret: RevealedWebhookSecret | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!secret) return null;

  const copy = () => {
    void copyToClipboard(secret.secretKey).then(ok => {
      setCopied(ok);
      setCopyFailed(!ok);
    });
  };

  return (
    <div role="alert" className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-2xl p-4 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
          <Key className="w-4 h-4 shrink-0" />
          <span>کلید امضای درگاه «{secret.name}»</span>
        </div>
        <button type="button" onClick={onClose} title="بستن" className="p-1 text-amber-700 dark:text-amber-300 hover:text-amber-900">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-amber-800 dark:text-amber-300">
        این کلید فقط همین یک بار نشان داده می‌شود. آن را کپی کنید و به سامانه مقصد بدهید تا امضای رویدادها را بیازماید.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-[11px] break-all bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 dir-ltr text-left">
          {secret.secretKey}
        </code>
        <button type="button" onClick={copy} title="کپی کلید امضا" className="p-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-300">
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      {copyFailed && <p className="text-rose-600">کپی ممکن نشد؛ کلید را دستی برگزینید و کپی کنید.</p>}
    </div>
  );
}
