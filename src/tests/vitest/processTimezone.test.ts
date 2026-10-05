import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

// v8.0.52 (TD-314): فرایند سرور به وقت UTC است تا زمان‌های سرورِ بی‌نشانه منطقه (UTC) درست خوانده شوند
describe('server process time zone', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('reads a server timestamp as UTC even on a host set to Tehran time', async () => {
    process.env.TZ = 'Asia/Tehran';
    expect(new Date('2026-03-20 20:30:00').toISOString()).toBe('2026-03-20T17:00:00.000Z');
    await import('../../lib/processTimezone');
    expect(process.env.TZ).toBe('UTC');
    expect(new Date('2026-03-20 20:30:00').toISOString()).toBe('2026-03-20T20:30:00.000Z');
  });

  it('is the first import of the server and the test runner', () => {
    const firstImport = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8')
      .split('\n').find(line => line.startsWith('import '));
    expect(firstImport('server.ts')).toBe("import './src/lib/processTimezone.js';");
    expect(firstImport('scripts/run-tests.ts')).toBe("import '../src/lib/processTimezone.js';");
  });
});
