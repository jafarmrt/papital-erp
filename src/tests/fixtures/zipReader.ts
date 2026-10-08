import zlib from 'zlib';
import { crc32 } from '../../lib/zipStream.js';

/**
 * v9.0.356 (TD-592): reads a whole ZIP buffer through its central directory (stored and DEFLATE entries) and checks
 * every entry's CRC and size, so a test sees exactly what an unzip tool would.
 */
export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP archive: end of central directory record missing');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory header at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    p += 46 + nameLength + extraLength + commentLength;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header of ${name}`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== size) throw new Error(`${name}: size ${data.length} (central directory says ${size})`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    entries.set(name, data);
  }
  return entries;
}

/** Rows of an NDJSON entry */
export function ndjsonRows(data: Buffer | undefined): Array<Record<string, unknown>> {
  if (!data) return [];
  return data.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

/** supertest parser that keeps a binary body as one Buffer */
export function binaryParser(res: NodeJS.ReadableStream, done: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
  res.on('error', (err: Error) => done(err, Buffer.alloc(0)));
}
