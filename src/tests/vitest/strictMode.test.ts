import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorMessageOf } from '../../utils/formatters';

describe('TypeScript strict mode (audit P3-3)', () => {
  it('tsconfig.json enables strict', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.json'), 'utf8')) as { compilerOptions?: { strict?: boolean } };
    expect(tsconfig.compilerOptions?.strict).toBe(true);
  });
});

describe('errorMessageOf (catch variables are unknown under strict)', () => {
  it('returns the message of an Error or an error-like object', () => {
    expect(errorMessageOf(new Error('موجودی کافی نیست'))).toBe('موجودی کافی نیست');
    expect(errorMessageOf({ message: 'خطای سرور' })).toBe('خطای سرور');
  });

  it('returns an empty string otherwise, so `errorMessageOf(err) || fallback` keeps the old err.message behaviour', () => {
    expect(errorMessageOf(undefined)).toBe('');
    expect(errorMessageOf(null)).toBe('');
    expect(errorMessageOf('plain text')).toBe('');
    expect(errorMessageOf({ message: 42 })).toBe('');
    expect(errorMessageOf(new Error('')) || 'پیش‌فرض').toBe('پیش‌فرض');
  });
});
