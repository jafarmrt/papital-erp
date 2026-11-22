import { createContext, useContext } from 'react';
import { mediaPath } from './brand';

/**
 * v12 phase 10c: where the images of a page of the ERP are read from. On the site that is `/media/<file>`; in a
 * preview of a draft the images are not on the site yet, so they are read under the preview's own key.
 */
export type PageMediaPath = (sha256: string, thumb?: boolean) => string;

const PageMediaContext = createContext<PageMediaPath>(mediaPath);
export const PageMediaProvider = PageMediaContext.Provider;
export const usePageMediaPath = (): PageMediaPath => useContext(PageMediaContext);

/** The image path of a preview: `/preview/<key>/media/<file>` */
export const previewMediaPath = (token: string): PageMediaPath => (sha256, thumb = false) => `/preview/${token}/media/${sha256}${thumb ? '-thumb' : ''}.webp`;
