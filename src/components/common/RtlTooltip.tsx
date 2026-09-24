import React, { useState, useRef, useEffect, ReactNode } from 'react';

export type TooltipPosition = 'top' | 'bottom' | 'right' | 'left';

export interface RtlTooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  className?: string;
  delay?: number;
  maxWidth?: number | string;
  disabled?: boolean;
}

/**
 * کامپوننت بومی و بهینه‌شده تولتیپ فارسی (RTL Micro-Interactions - فاز ۵)
 * ویژگی‌ها:
 * - پشتیبانی ذاتی از جهت‌گیری راست‌به‌چپ (RTL) و قلم فارسی
 * - جلوگیری از خروج کادر از لبه‌های مانیتور (Collision & Viewport Overflow Detection)
 * - انیمیشن ورود ملایم و سازگار با حالت تاریک و روشن
 * - عدم اشغال فضای دکمه یا اخلال در رویدادهای کلیک کامپوننت فرزند
 */
export const RtlTooltip: React.FC<RtlTooltipProps> = ({
  content,
  children,
  position = 'top',
  className = '',
  delay = 150,
  maxWidth = 260,
  disabled = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [resolvedPosition, setResolvedPosition] = useState<TooltipPosition>(position);
  const targetRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<any>(null);

  const calculatePosition = () => {
    if (!targetRef.current || !tooltipRef.current) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const padding = 8;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    let nextPos = position;
    let top = 0;
    let left = 0;

    // بررسی سرریز عمودی
    if (position === 'top' && targetRect.top - tooltipRect.height - padding < 0) {
      nextPos = 'bottom';
    } else if (position === 'bottom' && targetRect.bottom + tooltipRect.height + padding > window.innerHeight) {
      nextPos = 'top';
    }

    // محاسبه مختصات بر اساس موقعیت نهایی
    if (nextPos === 'top') {
      top = targetRect.top - tooltipRect.height - padding;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
    } else if (nextPos === 'bottom') {
      top = targetRect.bottom + padding;
      left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
    } else if (nextPos === 'left') {
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      left = targetRect.left - tooltipRect.width - padding;
    } else if (nextPos === 'right') {
      top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      left = targetRect.right + padding;
    }

    // بررسی سرریز افقی و محصور کردن در لبه‌های مانیتور
    if (left < padding) {
      left = padding;
    } else if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding;
    }

    setResolvedPosition(nextPos);
    setCoords({
      top: top + scrollY,
      left: left + scrollX,
    });
  };

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={targetRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      className={`inline-flex items-center ${className}`}
    >
      {children}

      {isVisible && !disabled && content && (
        <div
          ref={tooltipRef}
          role="tooltip"
          dir="rtl"
          data-placement={resolvedPosition}
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
            zIndex: 99999,
          }}
          className={`pointer-events-none px-2.5 py-1.5 rounded-lg text-xs leading-5 bg-slate-900/95 dark:bg-slate-800 text-slate-100 shadow-xl border border-slate-750 backdrop-blur-xs transition-opacity duration-150 animate-in fade-in-0 zoom-in-95 select-none`}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default RtlTooltip;
