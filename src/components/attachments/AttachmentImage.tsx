import type { ImgHTMLAttributes } from 'react';
import { useAttachmentSrc } from '../../hooks/useAttachmentSrc';

type AttachmentImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string | undefined };

/** تصویر پیوست (v7.0.100، TD-224 بند ۲): در حالت توکن در حافظه فایل محافظت‌شده با هدر Bearer بارگذاری می‌شود. */
export function AttachmentImage({ src, alt = '', ...rest }: AttachmentImageProps) {
  const resolved = useAttachmentSrc(src);
  if (!resolved) return <span className={rest.className} aria-busy="true" />;
  return <img src={resolved} alt={alt} {...rest} />;
}
