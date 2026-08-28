import React, { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';
// V10-3.1: حذف دیالوگ‌های native — تایید استاندارد مبتنی بر ConfirmModal با API Promise
// مصرف در hooks: `if (!(await confirmAction({ title, message }))) return;`
interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

type PendingRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

let pendingResolver: PendingRequest | null = null;
let notifyListeners: ((req: PendingRequest | null) => void) | null = null;

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (!opts?.message) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    // اگر یک درخواست باز وجود دارد، آن را بسته شده (ردشده) نهایی کن
    if (pendingResolver) {
      pendingResolver.resolve(false);
    }
    pendingResolver = { ...opts, resolve };
    if (notifyListeners) notifyListeners(pendingResolver);
  });
}

export function ConfirmDialogHost(): React.ReactElement {
  const [request, setRequest] = useState<PendingRequest | null>(null);

  useEffect(() => {
    notifyListeners = (req) => setRequest(req);
    if (pendingResolver) setRequest(pendingResolver);
    return () => {
      notifyListeners = null;
    };
  }, []);

  const settle = (result: boolean) => {
    const req = request;
    setRequest(null);
    pendingResolver = null;
    if (req) req.resolve(result);
  };

  return (
    <ConfirmModal
      isOpen={request !== null}
      title={request?.title}
      message={request?.message || ''}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
      confirmText={request?.confirmText}
      cancelText={request?.cancelText}
    />
  );
}

export default ConfirmDialogHost;
