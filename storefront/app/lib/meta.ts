import { BRAND } from './brand';

/** Title, description, canonical and social card of a page; absolute links only when the site address is known */
export function pageMeta({ title, description, path, image, siteUrl }: { title: string; description: string; path: string; image?: string; siteUrl: string }) {
  const full = title === BRAND.fullName ? title : `${title} | ${BRAND.fullName}`;
  const tags: Array<Record<string, string>> = [
    { title: full },
    { name: 'description', content: description },
    { property: 'og:title', content: full },
    { property: 'og:description', content: description },
    { property: 'og:locale', content: 'fa_IR' },
    { property: 'og:site_name', content: BRAND.fullName },
  ];
  if (siteUrl) {
    tags.push({ tagName: 'link', rel: 'canonical', href: `${siteUrl}${path}` }, { property: 'og:url', content: `${siteUrl}${path}` });
    if (image) tags.push({ property: 'og:image', content: `${siteUrl}${image}` });
  }
  return tags;
}
