// v10.0.38 (OBS-R2-33, TD-991): the customer and sales lead server code takes server timestamps only from businessClock
// (`systemNowUtcIso`), never from `new Date()` (AGENTS §6 and §23 business clock invariant).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');
const FILES = [
  'services/customer.service.ts',
  'routes/customers.routes.ts',
  'routes/crm.routes.ts',
  ...readdirSync(join(SRC, 'services/crm')).filter(f => f.endsWith('.ts')).map(f => `services/crm/${f}`),
];

describe('customer and sales lead server clock (OBS-R2-33)', () => {
  it('never reads the time with new Date()', () => {
    const offenders = FILES.flatMap(file => readFileSync(join(SRC, file), 'utf8').split('\n')
      .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
      .filter(({ line }) => /new Date\(\s*\)/.test(line) && !line.trim().startsWith('//'))
      .map(({ at }) => at));
    expect(offenders).toEqual([]);
  });
});
