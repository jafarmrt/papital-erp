import React from 'react';
import { AlertTriangle } from 'lucide-react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div 
        className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-150"
        dir="rtl"
      >
        <div className="px-6 py-4 border-b bg-slate-50 flex items-center gap-2 text-slate-800">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <h3 className="font-bold text-base">{title}</h3>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 leading-relaxed font-sans">{message}</p>
          
          <div className="mt-6 flex justify-end gap-2 text-xs">
            <button 
              type="button" 
              onClick={onCancel} 
              className="px-4 py-2 border rounded-lg font-medium hover:bg-slate-50 transition-colors text-slate-700"
            >
              {cancelText}
            </button>
            <button 
              type="button" 
              onClick={() => {
                onConfirm();
              }} 
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
