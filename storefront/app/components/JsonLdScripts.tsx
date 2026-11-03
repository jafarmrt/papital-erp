import { jsonLdHtml, type JsonLd } from '../lib/jsonLd';

/** One <script type="application/ld+json"> per block; nothing while the site address is unknown */
export function JsonLdScripts({ blocks, siteUrl }: { blocks: JsonLd[]; siteUrl: string }) {
  if (!siteUrl) return null;
  return (
    <>
      {blocks.map((block, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(block) }} />)}
    </>
  );
}
