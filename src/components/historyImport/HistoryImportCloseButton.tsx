import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { errorMessageOf } from '../../utils';
import { toast as hotToast } from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';

/**
 * v11 history import, tool 9: «پایان ورود سابقه», shown to the system admin only in the import windows. After a warning
 * that it cannot be undone it closes every Excel history import for good; the window then closes and the menus drop it.
 */
export function HistoryImportCloseButton({ onClosed }: { onClosed: () => void }) {
  const { userPermissions } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!userPermissions.isAdmin) return null;

  const close = async () => {
    const ok = await confirmAction({
      title: 'پایان ورود سابقه',
      message: 'با این کار ورود سابقه از اکسل (دریافت و پرداخت، انبار و فاکتورهای فروش) برای همیشه بسته می‌شود و دیگر باز نمی‌شود؛ از این پس هر سند با دست ثبت می‌شود. پیش از آن مطمئن شوید همهٔ ماه‌های ۱۴۰۵ وارد شده‌اند. ادامه می‌دهید؟',
      confirmText: 'بله، برای همیشه ببند',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await fetchJson('/history-import/close', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      hotToast.success('ورود سابقه از اکسل بسته شد.');
      onClosed();
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'ورود سابقه بسته نشد.');
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.historyImport.status() });
    }
  };

  return (
    <button type="button" disabled={busy} onClick={() => { void close(); }}
      className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950">
      پایان ورود سابقه
    </button>
  );
}
