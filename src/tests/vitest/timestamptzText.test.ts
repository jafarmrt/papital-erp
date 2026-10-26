import { describe, expect, it } from 'vitest';
import pkg from 'pg';
import { timestamptzTextAsUtc } from '../../lib/serverTimestamp';
import { withUtcTimestamptzText } from '../../db/serverTimestampClient';

const { TIMESTAMPTZ, TIMESTAMP, INT4 } = pkg.types.builtins;

// v11 (phase 4.2): the server timestamps are timestamptz, and the app still reads the UTC text it always had
describe('timestamptz text as the UTC server time', () => {
  it('drops a zero offset and keeps every fraction digit', () => {
    expect(timestamptzTextAsUtc('2026-10-26 07:17:40.123456+00')).toBe('2026-10-26 07:17:40.123456');
    expect(timestamptzTextAsUtc('2026-10-26 07:17:40+00')).toBe('2026-10-26 07:17:40');
    expect(timestamptzTextAsUtc('2026-10-26 07:17:40.5+00:00')).toBe('2026-10-26 07:17:40.5');
  });

  it('moves another offset (a session outside UTC) to UTC', () => {
    expect(timestamptzTextAsUtc('2026-01-01 10:00:00.5+03:30')).toBe('2026-01-01 06:30:00.5');
    expect(timestamptzTextAsUtc('2026-01-01 01:00:00-05')).toBe('2026-01-01 06:00:00');
    expect(timestamptzTextAsUtc('2026-01-01 02:00:00+03:30')).toBe('2025-12-31 22:30:00');
  });

  it('keeps text that is not a timestamptz', () => {
    for (const text of ['infinity', '-infinity', '2026-10-26 07:17:40', '2026-10-26']) expect(timestamptzTextAsUtc(text)).toBe(text);
  });
});

describe("Drizzle's query types", () => {
  const drizzleTypes = { getTypeParser: (oid: number) => (oid === TIMESTAMPTZ || oid === TIMESTAMP ? (v: string) => v : (v: string) => Number(v)) };
  const parser = (config: { types?: typeof drizzleTypes }, oid: number) =>
    (config.types!.getTypeParser(oid) as (v: string) => unknown);

  it('reads timestamptz as the UTC text and leaves the other types to Drizzle', () => {
    const config = withUtcTimestamptzText({ text: 'select 1', types: drizzleTypes });
    expect(parser(config, TIMESTAMPTZ)('2026-10-26 07:17:40.12+00')).toBe('2026-10-26 07:17:40.12');
    expect(parser(config, TIMESTAMP)('2026-10-26 07:17:40.12')).toBe('2026-10-26 07:17:40.12');
    expect(parser(config, INT4)('7')).toBe(7);
  });

  it('leaves a query without types (pg returns a Date) and a submittable query as they are', () => {
    expect(withUtcTimestamptzText('select now()')).toBe('select now()');
    const plain = { text: 'select now()' };
    expect(withUtcTimestamptzText(plain)).toBe(plain);
    const cursor = { submit: () => undefined, types: drizzleTypes };
    expect(withUtcTimestamptzText(cursor)).toBe(cursor);
  });
});
