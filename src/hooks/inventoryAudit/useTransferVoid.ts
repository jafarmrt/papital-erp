import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';

export interface VoidableTransfer {
  id: number;
  refNumber?: string;
  ref_number?: string;
}

/**
 * v9.0.73 (TD-489، تصمیم ت۲ الف): ابطال حواله انتقال بین انبارها با همان مسیر ابطال اسناد (DELETE /documents/:id):
 * کالا به انبار مبدأ برمی‌گردد و WAC تغییر نمی‌کند؛ اگر موجودی انبار مقصد پس از انتقال مصرف شده باشد، سرور ابطال را
 * با نام اسناد مصرف‌کننده رد می‌کند (TD-265).
 */
export function useTransferVoid(onVoided: () => void) {
  const [voidingId, setVoidingId] = useState<number | null>(null);

  const voidTransfer = async (transfer: VoidableTransfer): Promise<void> => {
    if (voidingId !== null) return;
    const ref = transfer.refNumber || transfer.ref_number || `#${transfer.id}`;
    const confirmed = await confirmAction({
      title: 'ابطال حواله انتقال',
      message: `حواله انتقال شماره «${ref}» باطل می‌شود و کالا به انبار مبدأ برمی‌گردد. ادامه می‌دهید؟`,
      confirmText: 'ابطال حواله',
      cancelText: 'انصراف',
    });
    if (!confirmed) return;
    setVoidingId(transfer.id);
    try {
      await fetchJson(`/documents/${transfer.id}`, { method: 'DELETE' });
      toast.success(`حواله انتقال شماره «${ref}» باطل شد.`);
      onVoided();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ابطال حواله انتقال');
    } finally {
      setVoidingId(null);
    }
  };

  return { voidingId, voidTransfer };
}
