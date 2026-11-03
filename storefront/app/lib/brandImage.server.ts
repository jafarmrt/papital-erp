import { createHash } from 'node:crypto';

const DATA_URL = /^data:(image\/(?:svg\+xml|png|webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** A short version of an image for its address, so a new logo is fetched at once and an unchanged one stays cached */
export const imageVersion = (dataUrl: string) => (dataUrl ? createHash('sha256').update(dataUrl).digest('hex').slice(0, 12) : '');

/** Width and height of a PNG from its header (no image library); null for any other format or a broken file */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function decodeDataUrl(dataUrl: string): { type: string; bytes: Buffer } | null {
  const match = DATA_URL.exec(dataUrl);
  return match ? { type: match[1], bytes: Buffer.from(match[2], 'base64') } : null;
}
