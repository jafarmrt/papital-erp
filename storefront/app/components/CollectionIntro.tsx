import { Link } from 'react-router';
import type { SiteCollectionText } from '../lib/collections';
import { NewsCover } from './NewsCover';

/**
 * v12 phase 10e: the words the shop wrote for a collection, above its products: its paragraphs beside its image (one
 * under the other on a phone), and «آشنایی بیشتر» when the shop named a page for it. Plain text only: nothing in it is
 * read as markup.
 */
export function CollectionIntro({ text }: { text: SiteCollectionText }) {
  const hasWords = text.paragraphs.length > 0;
  return (
    <div className={`mt-5 grid grid-cols-1 gap-6 ${text.image && hasWords ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-center lg:gap-10' : ''}`} data-collection-intro>
      {hasWords ? (
        <div className="min-w-0 max-w-3xl space-y-4 text-lg leading-9 text-muted-foreground">
          {text.paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-line break-words">{paragraph}</p>)}
          {text.moreHref ? (
            <p>
              <Link to={text.moreHref} className="inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline">آشنایی بیشتر</Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {text.image ? (
        <div className={`min-w-0 overflow-hidden rounded-surface bg-muted ${hasWords ? '' : 'max-w-xl'}`}>
          <NewsCover image={text.image} sizes="(min-width: 1024px) 40vw, 100vw" eager className="h-auto w-full" />
        </div>
      ) : null}
    </div>
  );
}
