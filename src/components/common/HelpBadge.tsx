import React, { ReactNode } from 'react';
import { HelpCircle, Info } from 'lucide-react';
import { RtlTooltip, TooltipPosition } from './RtlTooltip';

export interface HelpBadgeProps {
  /** متن یا محتوای راهنما */
  text: ReactNode;
  /** نوع آیکون (help = علامت سوال، info = علامت اطلاعات) */
  variant?: 'help' | 'info';
  /** موقعیت پیش‌فرض باز شدن تولتیپ */
  position?: TooltipPosition;
  /** عرض بیشینه کادر راهنما */
  maxWidth?: number | string;
  className?: string;
  iconSize?: number;
}

/**
 * بج راهنمای کمکی ارگونومیک و بومی (RTL HelpBadge - فاز ۵)
 * برای شفاف‌سازی اصطلاحات مالی، خزانه‌داری، چک‌های صیادی و قوانین انبارداری
 */
export const HelpBadge: React.FC<HelpBadgeProps> = ({
  text,
  variant = 'help',
  position = 'top',
  maxWidth = 260,
  className = '',
  iconSize = 14,
}) => {
  if (!text) return null;

  const IconComponent = variant === 'info' ? Info : HelpCircle;

  return (
    <RtlTooltip content={text} position={position} maxWidth={maxWidth}>
      <span
        tabIndex={0}
        aria-label="راهنمای فیلد"
        className={`inline-flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-help transition-colors outline-none focus:ring-1 focus:ring-indigo-400 rounded-full p-0.5 ${className}`}
      >
        <IconComponent size={iconSize} />
      </span>
    </RtlTooltip>
  );
};

export default HelpBadge;
