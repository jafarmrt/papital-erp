import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  containerClassName?: string;
  closeOnEscape?: boolean;
  closeOnBackdropClick?: boolean;
  showCloseButton?: boolean;
  hideHeader?: boolean;
  id?: string;
  ariaLabel?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-5xl',
  '4xl': 'max-w-6xl',
  '5xl': 'max-w-7xl',
  full: 'max-w-[96vw] h-[92vh]',
};

/**
 * Standard reusable Modal component for ERP V4.
 * Replaces repetitive custom modal backdrops, escape handlers, scroll locks, and headers.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  badge,
  size = 'lg',
  children,
  footer,
  headerClassName = '',
  bodyClassName = '',
  containerClassName = '',
  closeOnEscape = true,
  closeOnBackdropClick = true,
  showCloseButton = true,
  hideHeader = false,
  id,
  ariaLabel,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    // Prevent background body scrolling when modal is active
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      id={id ? `${id}-backdrop` : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-200"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : ariaLabel || 'پنجره پیام'}
    >
      <div
        ref={containerRef}
        id={id}
        className={`bg-white dark:bg-slate-900 w-full ${sizeClasses[size]} rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden transition-all transform duration-200 ${containerClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        {!hideHeader && (title || showCloseButton) && (
          <div
            className={`flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/80 shrink-0 ${headerClassName}`}
          >
            <div className="flex items-center gap-3 min-w-0 pr-1">
              {icon && (
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {typeof title === 'string' ? (
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                      {title}
                    </h3>
                  ) : (
                    title
                  )}
                  {badge}
                </div>
                {subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            {showCloseButton && (
              <button
                type="button"
                id={id ? `${id}-close-btn` : undefined}
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer shrink-0"
                aria-label="بستن پنجره"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div
          className={`flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 ${bodyClassName}`}
        >
          {children}
        </div>

        {/* Modal Footer */}
        {footer && (
          <div className="px-5 sm:px-6 py-3.5 sm:py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 flex items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Common modal footer action buttons
 */
export interface ModalFooterActionsProps {
  onCancel: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger' | 'warning' | 'success';
  isLoading?: boolean;
  isDisabled?: boolean;
  confirmIcon?: React.ReactNode;
  cancelIcon?: React.ReactNode;
  extraActions?: React.ReactNode;
}

export function ModalFooterActions({
  onCancel,
  onConfirm,
  confirmText = 'تایید و ذخیره',
  cancelText = 'انصراف',
  confirmVariant = 'primary',
  isLoading = false,
  isDisabled = false,
  confirmIcon,
  cancelIcon,
  extraActions,
}: ModalFooterActionsProps) {
  const variantClasses = {
    primary: 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold shadow-md shadow-amber-500/20',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md shadow-rose-600/20',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md shadow-amber-600/20',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20',
  };

  return (
    <div className="flex items-center justify-between w-full">
      <div>{extraActions}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer disabled:opacity-50"
        >
          {cancelIcon && <span className="inline-block ml-1.5">{cancelIcon}</span>}
          {cancelText}
        </button>

        {onConfirm && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading || isDisabled}
            className={`px-5 py-2 text-xs sm:text-sm rounded-xl transition cursor-pointer flex items-center gap-2 disabled:opacity-50 ${variantClasses[confirmVariant]}`}
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              confirmIcon
            )}
            <span>{confirmText}</span>
          </button>
        )}
      </div>
    </div>
  );
}
