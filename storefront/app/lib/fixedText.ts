import type { RichDoc } from '@erp/storefront/storefrontPageParts';

/**
 * v12 phase 10c (owner's decision 23): the words the shop wrote in «صفحه‌های سایت» for a page whose work is in this
 * site's code (a list, a form, the cart): its title, one text above the page's own work, and its search title and
 * description. null while the shop has published none: the page then keeps the words written in its own file, which are
 * given here as `today`.
 */
export interface FixedText { title: string; seoTitle: string; seoDescription: string; intro: RichDoc | null }

export const fixedTitle = (text: FixedText | null | undefined, today: string): string => text?.title || today;

/** The title and description of the page's `<head>`: the search words when written, else the page's title and today's description */
export const fixedHead = (text: FixedText | null | undefined, today: { title: string; description: string }) => ({
  title: text?.seoTitle || text?.title || today.title,
  description: text?.seoDescription || today.description,
});
