import crypto from 'crypto';
import { promisify } from 'util';

/**
 * v11 phase 8.2b (start plan §6 and §8, decision 4): the secrets of buyer accounts, with Node's own crypto (no new library).
 * A password is kept only as `scrypt$N$r$p$salt$hash` (base64url salt and hash); scrypt runs on libuv's thread pool, so a
 * sign-in does not hold the event loop. A session token and a set-password link are 256 random bits, and the database
 * keeps only their SHA-256.
 */
const scrypt = promisify(crypto.scrypt) as (password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;
export const SESSION_TOKEN_PREFIX = 'bs_';
export const PASSWORD_TOKEN_PREFIX = 'pw_';
export const BUYER_TOKEN_MAX = 80;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(password.normalize('NFC'), salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** A fixed hash to check a password against when no account matched, so an unknown phone costs the same time */
const DECOY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(SALT_BYTES).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;

/** Whether a password matches a stored hash (constant time); an empty or malformed hash matches nothing */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored || DECOY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (n !== N || r !== R || p !== P) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const want = Buffer.from(parts[5], 'base64url');
  const got = await scrypt(password.normalize('NFC'), salt, want.length || KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
  return Boolean(stored) && want.length === got.length && crypto.timingSafeEqual(want, got);
}

export const newToken = (prefix: string): string => prefix + crypto.randomBytes(TOKEN_BYTES).toString('base64url');

export const tokenHash = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

/** A presented token of the right shape, or '' (never looked up) */
export function presentedToken(raw: unknown, prefix: string): string {
  const text = String(raw ?? '').trim();
  return text.length <= BUYER_TOKEN_MAX && text.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(text) ? text : '';
}
