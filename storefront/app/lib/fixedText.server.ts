import type { FixedPageSlug } from '@erp/storefront/storefrontPageParts';
import { page } from './api.server';
import { docIsBlank } from './pages';
import type { FixedText } from './fixedText';

/**
 * The published words of one fixed page, or null (see `fixedText.ts`). It is read like a base page: kept a short while,
 * and while the ERP cannot be read the copy read last stays, so a page never falls back to its own words and then
 * changes again a minute later, and never goes down for its words.
 */
export async function fixedText(slug: FixedPageSlug): Promise<FixedText | null> {
  const found = await page(slug, { fallback: true });
  if (!found || found.kind !== 'fixed') return null;
  const first = found.sections[0];
  return {
    title: found.title, seoTitle: found.seoTitle, seoDescription: found.seoDescription,
    intro: first?.kind === 'text' && !docIsBlank(first.doc) ? first.doc : null,
  };
}
