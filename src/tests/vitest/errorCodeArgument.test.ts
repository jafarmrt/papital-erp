import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../errors/customErrors';

// v10.1.49 closing sweep: an error class with (message, details, code) takes its code as the third argument. Six
// services passed it second, so it landed in `details` and the answer said CONFLICT (the fiscal-year closing with
// draft vouchers, a closing already running, a closed year, the attachment jobs and the factory reset while seeding).
const ROOT = path.resolve(__dirname, '../..');
const CLASSES = ['ConflictError', 'ValidationError', 'NotFoundError', 'ForbiddenError'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** top-level arguments of the call that opens at `start` (just after its parenthesis) */
function callArguments(text: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += text[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function codeInDetailsCalls(text: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`new (${CLASSES.join('|')})\\(`, 'g');
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const args = callArguments(text, m.index + m[0].length);
    if (args.length === 2 && /^'[A-Z][A-Z0-9_]+'$/.test(args[1])) found.push(`${m[1]} ${args[1]}`);
  }
  return found;
}

describe('error codes go in the third argument', () => {
  it('finds a code passed as details', () => {
    expect(codeInDetailsCalls("throw new ConflictError('x', 'SOME_CODE');")).toEqual(['ConflictError \'SOME_CODE\'']);
    expect(codeInDetailsCalls("throw new ConflictError('x', undefined, 'SOME_CODE');")).toEqual([]);
    expect(codeInDetailsCalls("throw new ValidationError(`a ${b('c, d')}`, { e: 1 });")).toEqual([]);
  });

  it('no production file passes a code as details', () => {
    const wrong = sourceFiles(ROOT).flatMap(file =>
      codeInDetailsCalls(fs.readFileSync(file, 'utf8')).map(call => `${path.relative(ROOT, file)}: ${call}`));
    expect(wrong).toEqual([]);
  });

  it('a conflict built the right way answers its own code', () => {
    expect(new ConflictError('x', undefined, 'FISCAL_YEAR_HAS_DRAFT_VOUCHERS').code).toBe('FISCAL_YEAR_HAS_DRAFT_VOUCHERS');
  });
});
