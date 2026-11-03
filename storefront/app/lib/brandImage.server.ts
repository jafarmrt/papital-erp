import { createHash } from 'node:crypto';

const DATA_URL = /^data:(image\/(?:svg\+xml|png|webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** A short version of an image for its address, so a new logo is fetched at once and an unchanged one stays cached */
export const imageVersion = (dataUrl: string) => (dataUrl ? createHash('sha256').update(dataUrl).digest('hex').slice(0, 12) : '');

export function decodeDataUrl(dataUrl: string): { type: string; bytes: Buffer } | null {
  const match = DATA_URL.exec(dataUrl);
  return match ? { type: match[1], bytes: Buffer.from(match[2], 'base64') } : null;
}
