/**
 * v9.0.380 (TD-707, B15-05, decision t3 a): the event types the webhook form and the rule editor offer
 * (PUBLISHED_EVENT_TYPES) are exactly the types the server publishes. Every `createEvent(` / `publishEvent(` call in
 * production server code is read and its event type resolved (a DomainEventType member, a string literal, or a local
 * constant built from them); a type offered but never published, or published but not offered, fails the test.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { DomainEventType } from '../../services/events/domainEvents';
import {
  ALL_EVENTS_PATTERN,
  PUBLISHED_EVENT_TYPES,
  eventTypeLabel,
  isSubscribableEventPattern,
  unknownEventPatterns,
} from '../../lib/events/eventTypeCatalog';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['src/services', 'src/routes', 'src/lib'];
// the bus itself forwards a caller's type; the event contract file only declares them
const SKIPPED_FILES = new Set(['src/services/events/domainEventBus.ts', 'src/services/events/domainEvents.ts']);

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(rel);
    return /\.tsx?$/.test(entry.name) && !SKIPPED_FILES.has(rel) ? [rel] : [];
  });
}

const enumValues = DomainEventType as unknown as Record<string, string>;

/** event types named in an expression: its DomainEventType members, else its string literals */
function typesIn(expression: string): string[] {
  const members = [...expression.matchAll(/DomainEventType\.([A-Z_]+)/g)].map(m => enumValues[m[1]] ?? `?${m[1]}`);
  if (members.length > 0) return members;
  return [...expression.matchAll(/'([^']+)'|"([^"]+)"/g)].map(m => m[1] ?? m[2]);
}

// the event simulation tool publishes the type its caller sends, with this default (B15-06 / TD-708 handles the tool)
const SIMULATION_DEFAULT_TYPES = new Set(['SimulatedTestEvent']);

/** the first argument of every createEvent( / publishEvent( call, resolved to event types */
function publishedTypesOf(file: string, source: string): { types: string[]; unresolved: string[] } {
  const types: string[] = [];
  const unresolved: string[] = [];
  for (const match of source.matchAll(/\b(?:createEvent|publishEvent)(?:<[^>]*>)?\(/g)) {
    let depth = 0;
    let end = match.index! + match[0].length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
      else if (ch === ',' && depth === 0) break;
    }
    const arg = source.slice(match.index! + match[0].length, end).trim();
    if (!arg || /^eventType\s*:/.test(arg)) continue; // a declaration, not a call
    let found = typesIn(arg);
    if (found.length === 0 && /^[A-Za-z_$][\w$]*$/.test(arg)) {
      const decl = new RegExp(`const\\s+${arg}\\s*=([^;]+);`).exec(source.slice(0, match.index));
      found = decl ? typesIn(decl[1]) : [];
    }
    if (found.length === 0) unresolved.push(`${file}: ${arg}`);
    types.push(...found);
  }
  return { types, unresolved };
}

function scanPublishedTypes(): { published: Set<string>; unresolved: string[] } {
  const published = new Set<string>();
  const unresolved: string[] = [];
  for (const file of SCAN_DIRS.flatMap(sourceFiles)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const result = publishedTypesOf(file, source);
    result.types.forEach(t => published.add(t));
    unresolved.push(...result.unresolved);
  }
  return { published, unresolved };
}

describe('event type catalog (TD-707)', () => {
  const { published, unresolved } = scanPublishedTypes();
  const offered = PUBLISHED_EVENT_TYPES.map(t => t.value);

  it('resolves the event type of every publishing call in server code', () => {
    expect(unresolved).toEqual([]);
    expect(published.size).toBeGreaterThan(5);
  });

  it('offers only event types the server publishes', () => {
    expect(offered.filter(t => !published.has(t))).toEqual([]);
  });

  it('offers every event type the server publishes', () => {
    expect([...published].filter(t => !offered.includes(t) && !SIMULATION_DEFAULT_TYPES.has(t)).sort()).toEqual([]);
  });

  it('has one Persian label per type and no dotted legacy preset', () => {
    expect(new Set(offered).size).toBe(offered.length);
    for (const t of PUBLISHED_EVENT_TYPES) expect(t.label).toMatch(/[؀-ۿ]/);
    expect(eventTypeLabel(ALL_EVENTS_PATTERN)).toBe('همه رویدادها');
    expect(unknownEventPatterns(['*', 'InvoiceApproved', 'document.invoiced', 'inventory.*', 'InvoiceCancelled']))
      .toEqual(['document.invoiced', 'inventory.*', 'InvoiceCancelled']);
    expect(isSubscribableEventPattern('woocommerce.order.synced')).toBe(true);
  });
});
