import zlib from 'zlib';
import type { Writable } from 'stream';

/**
 * v9.0.356 (TD-592): نویسنده جریانی ZIP، بی وابستگی تازه.
 * هر ورودی با DEFLATE فشرده و تکه‌به‌تکه در خروجی نوشته می‌شود و فشار برگشتی (`drain`) هم خروجی و هم فشرده‌ساز
 * رعایت می‌شود، پس هیچ‌وقت کل داده در حافظه نیست. CRC و اندازه‌ها پس از هر ورودی در «توصیفگر داده» (بیت ۳) می‌آیند.
 * ZIP64 ندارد: ورودی یا بایگانی بزرگ‌تر از ۴ گیگابایت با خطا متوقف می‌شود.
 */

const ZIP32_LIMIT = 0xffffffff;
const MAX_ENTRIES = 0xffff;
const FLAGS = 0x0808; // bit 3: data descriptor; bit 11: UTF-8 names
const METHOD_DEFLATE = 8;
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE) of `buf`, continuing from `previous` */
export function crc32(buf: Buffer, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The output stream closed (client went away) before the archive was finished */
export class ZipOutputClosedError extends Error {
  constructor() {
    super('ZIP output stream closed before the archive was finished');
    this.name = 'ZipOutputClosedError';
  }
}

/** An entry or the archive passed the 4 GiB limit of ZIP without ZIP64 */
export class ZipSizeLimitError extends Error {
  constructor(what: string) {
    super(`ZIP limit reached: ${what} exceeds 4 GiB (ZIP64 is not supported)`);
    this.name = 'ZipSizeLimitError';
  }
}

export interface ZipEntryInfo {
  name: string;
  crc: number;
  uncompressedBytes: number;
  compressedBytes: number;
  offset: number;
}

type WaitableStream = Pick<Writable, 'destroyed' | 'writableEnded' | 'on' | 'once' | 'off'>;

/** Resolves on `drain`; rejects when the stream closes or fails first */
function waitForDrain(stream: WaitableStream): Promise<void> {
  if (stream.destroyed || stream.writableEnded) return Promise.reject(new ZipOutputClosedError());
  return new Promise((resolve, reject) => {
    const done = (err?: unknown) => {
      stream.off('drain', onDrain);
      stream.off('close', onClose);
      stream.off('error', onError);
      if (err) reject(err); else resolve();
    };
    const onDrain = () => done();
    const onClose = () => done(new ZipOutputClosedError());
    const onError = (err: unknown) => done(err);
    stream.on('drain', onDrain);
    stream.on('close', onClose);
    stream.on('error', onError);
  });
}

/** MS-DOS time and date fields of a wall-clock moment given as `YYYY-MM-DDTHH:mm:ss` */
export function dosDateTime(wallClock: string): { time: number; date: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(wallClock);
  if (!m) return { time: 0, date: (1 << 5) | 1 };
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return {
    time: (h << 11) | (mi << 5) | Math.floor(s / 2),
    date: ((Math.max(1980, y) - 1980) << 9) | (mo << 5) | d,
  };
}

export class ZipStreamWriter {
  private offset = 0;
  private readonly entries: ZipEntryInfo[] = [];
  private readonly dos: { time: number; date: number };

  /** `modifiedAt`: wall-clock time stored on every entry (`YYYY-MM-DDTHH:mm:ss`, the business time zone) */
  constructor(private readonly out: Writable, modifiedAt: string) {
    this.dos = dosDateTime(modifiedAt);
  }

  get bytesWritten(): number {
    return this.offset;
  }

  private async write(buf: Buffer): Promise<void> {
    if (this.out.destroyed || this.out.writableEnded) throw new ZipOutputClosedError();
    this.offset += buf.length;
    if (this.offset > ZIP32_LIMIT) throw new ZipSizeLimitError('the archive');
    if (!this.out.write(buf)) await waitForDrain(this.out);
  }

  /** Writes one compressed entry whose content comes from `source`, chunk by chunk */
  async addEntry(name: string, source: AsyncIterable<string | Buffer> | Iterable<string | Buffer>): Promise<ZipEntryInfo> {
    if (this.entries.length >= MAX_ENTRIES) throw new ZipSizeLimitError('the entry count');
    const nameBytes = Buffer.from(name, 'utf8');
    const offset = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(this.dos.time, 10);
    header.writeUInt16LE(this.dos.date, 12);
    // crc and sizes (14..25) stay 0: they follow in the data descriptor
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    await this.write(Buffer.concat([header, nameBytes]));

    const deflate = zlib.createDeflateRaw({ level: 6 });
    deflate.on('error', () => undefined); // errors reach the pump and the writer loop below
    let compressed = 0;
    const pump = (async () => {
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        compressed += chunk.length;
        await this.write(chunk);
      }
    })();
    pump.catch((err: unknown) => deflate.destroy(err instanceof Error ? err : new Error(String(err))));

    let crc = 0;
    let size = 0;
    try {
      for await (const piece of source) {
        const buf = typeof piece === 'string' ? Buffer.from(piece, 'utf8') : piece;
        if (buf.length === 0) continue;
        crc = crc32(buf, crc);
        size += buf.length;
        if (size > ZIP32_LIMIT) throw new ZipSizeLimitError(`entry ${name}`);
        if (deflate.destroyed) break;
        if (!deflate.write(buf)) await waitForDrain(deflate);
      }
      deflate.end();
      await pump;
    } catch (err) {
      deflate.destroy();
      await pump.catch(() => undefined);
      throw err;
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.write(descriptor);

    const info: ZipEntryInfo = { name, crc, uncompressedBytes: size, compressedBytes: compressed, offset };
    this.entries.push(info);
    return info;
  }

  /** Writes the central directory and ends the output */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const nameBytes = Buffer.from(e.name, 'utf8');
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(VERSION, 4);
      h.writeUInt16LE(VERSION, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(METHOD_DEFLATE, 10);
      h.writeUInt16LE(this.dos.time, 12);
      h.writeUInt16LE(this.dos.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedBytes, 20);
      h.writeUInt32LE(e.uncompressedBytes, 24);
      h.writeUInt16LE(nameBytes.length, 28);
      // extra, comment, disk, internal and external attributes stay 0
      h.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([h, nameBytes]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    this.out.end();
  }
}
