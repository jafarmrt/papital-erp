import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalFooterActions } from './common/Modal';

/**
 * v10.0.8 (TD-1040): a confirmation is asked from inside other windows (the payslip payment window is z-[90]), so it
 * stacks above every window of the app (highest z-[110]) and below only the startup overlay and open pick lists.
 */
export const CONFIRM_LAYER_CLASS = 'z-[200]';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  /** OBS-R1-34: may return a promise; the window then runs once, shows «running» and keeps Esc and cancel off */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
  /** the caller's own running flag (a mutation's isPending) */
  isLoading?: boolean;
  confirmText?: string;
  cancelText?: string;
}

export default function ConfirmModal({
  isOpen,
  title = 'تایید عملیات',
  message,
  onConfirm,
  onCancel,
  confirmText = 'بله، مطمئنم',
  cancelText = 'انصراف',
  isLoading = false,
}: ConfirmModalProps) {
  // OBS-R1-34: a second click while the action runs sends nothing; the ref sees it before React re-renders
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const busy = running || isLoading;

  const handleConfirm = async () => {
    if (runningRef.current || isLoading) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await onConfirm();
    } catch {
      // the caller reports its own error (a mutation's onError); the window stays open for another try
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };
  const handleCancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      icon={<AlertTriangle className="text-amber-500 shrink-0 w-5 h-5" />}
      size="sm"
      layerClassName={CONFIRM_LAYER_CLASS}
      closeOnEscape={!busy}
      closeOnBackdropClick={!busy}
      showCloseButton={!busy}
      footer={
        <ModalFooterActions
          onCancel={handleCancel}
          onConfirm={() => void handleConfirm()}
          confirmText={confirmText}
          cancelText={cancelText}
          confirmVariant="danger"
          isLoading={busy}
        />
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
        {message}
      </p>
    </Modal>
  );
}

