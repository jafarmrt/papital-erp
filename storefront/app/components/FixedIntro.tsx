import type { ReactNode } from 'react';
import type { FixedText } from '../lib/fixedText';
import { RichText } from './RichText';

/**
 * The text above a fixed page's own work (v12 phase 10c): the one the shop published, or, while there is none, the
 * words the page has in its own file (`children`).
 */
export function FixedIntro({ text, children = null, className = '' }: { text: FixedText | null | undefined; children?: ReactNode; className?: string }) {
  if (text?.intro) return <RichText doc={text.intro} className={className} />;
  return <>{children}</>;
}
