import { useEffect } from 'react';

/**
 * Favicon واحد سامانه: به‌صورت پیش‌فرض نشان داخلی (/favicon.svg) است و
 * در صورت تعریف «لوگوی شرکت» در تنظیمات، همان لوگو جایگزین فاوآیکون می‌شود.
 */
export function useAppFavicon(logoUrl: string | null | undefined) {
  useEffect(() => {
    if (!logoUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link#app-favicon, link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.id = 'app-favicon';
      document.head.appendChild(link);
    }
    link.removeAttribute('type');
    link.href = logoUrl;
  }, [logoUrl]);
}
