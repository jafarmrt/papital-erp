import { AlertTriangle } from 'lucide-react';
import { Modal, ModalFooterActions } from './common/Modal';

/**
 * v10.0.1 (TD-1040): a confirmation is asked from inside other windows (the payslip payment window is z-[90]), so it
 * stacks above every window of the app (highest z-[110]) and below only the startup overlay and open pick lists.
 */
export const CONFIRM_LAYER_CLASS = 'z-[200]';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
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
  cancelText = 'انصراف'
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      icon={<AlertTriangle className="text-amber-500 shrink-0 w-5 h-5" />}
      size="sm"
      layerClassName={CONFIRM_LAYER_CLASS}
      closeOnEscape
      closeOnBackdropClick
      footer={
        <ModalFooterActions
          onCancel={onCancel}
          onConfirm={onConfirm}
          confirmText={confirmText}
          cancelText={cancelText}
          confirmVariant="danger"
        />
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
        {message}
      </p>
    </Modal>
  );
}

