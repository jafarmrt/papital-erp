import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalFooterActions } from './common/Modal';

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

