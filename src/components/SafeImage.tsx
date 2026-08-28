import React, { useState } from 'react';

interface SafeImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  onClick?: () => void;
  /** آیکون lucide برای placeholder */
  fallbackIcon?: React.ReactNode;
  /** متن کوتاه نمایش‌داده‌شده در placeholder */
  fallbackText?: string;
}

/**
 * V9 Phase 4.3: تصویر امن با placeholder — عکس‌های شکسته (لینک مرده WooCommerce،
 * حذف‌شده از uploads و ...) به جای آیکن broken مرورگر، placeholder برندشده نشان می‌دهند.
 */
export function SafeImage({ src, alt, className, onClick, fallbackIcon, fallbackText }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  if (showFallback) {
    return (
      <div
        className={`bg-slate-100 border border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-400 ${className || ''}`}
        title={alt}
        onClick={onClick}
      >
        {fallbackIcon}
        {fallbackText && <span className="text-[8px] font-bold leading-none">{fallbackText}</span>}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default SafeImage;
