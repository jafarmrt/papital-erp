// @vitest-environment node
/**
 * Series 10 roadmap §4 (phase-2 decisions t2 to t5): the architecture ratchet in
 * scripts/ratchets/architectureRatchet.ts counts route writes, pool fallbacks of an optional transaction, hand-written
 * route error answers, generic service errors and server imports against the package direction per file, against scripts/ratchets/architecture-baseline.json; no file
 * may gain one and the baseline may only shrink.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  compareWithBaseline,
  countSource,
  currentState,
  type ArchitectureBaseline,
} from '../../../scripts/ratchets/architectureRatchet';
import { boundaryState, importAllowed, importSpecifiers, packageOf, parsePackageMap } from '../../../scripts/ratchets/packageBoundary';

describe('architecture_ratchet: phase-2 decisions may only shrink their debt', () => {
  it('counts Drizzle table writes in a route, not service calls, selects or comments', () => {
    const route = `
      import { users, roles } from '../db/schema.js';
      import * as schema from '../db/schema';
      // orm.insert(users) in a comment
      await orm.insert(users).values({});
      await tx.update(roles).set({}).where(x);
      await orm.delete(schema.notifications);
      await UserService.update(user);
      await orm.select().from(users);
      const { warehouses } = await import('../db/schema.js');
      await orm.insert(warehouses).values({});
      const label = 'orm.update(users)';
    `;
    expect(countSource('src/routes/x.routes.ts', route).routeWrites).toBe(4);
    expect(countSource('src/services/x.service.ts', route).routeWrites).toBe(0);
  });

  it('counts an optional transaction replaced by the pool, not a query on the pool', () => {
    const source = `
      async function a(tx?: Tx) { const db = tx || orm; const e = tx ?? orm; }
      async function b(executor: DbExecutor = orm) { let d; d = orm; }
      async function c() { await orm.select().from(t); const q = orm.insert(t); if (tx === orm) return; }
    `;
    expect(countSource('src/services/x.ts', source).ormFallback).toBe(4);
  });

  it('counts hand-written error answers in routes and generic errors in services', () => {
    const route = `res.status(404).json({ error: 'x' }); res.status(500).send('x'); res.status(201).json(x); other.status(400);`;
    expect(countSource('src/routes/x.routes.ts', route).routeErrorResponses).toBe(2);
    const service = `throw new Error('x'); throw new ValidationError('x'); const e = new Error('y');`;
    expect(countSource('src/services/x.ts', service).serviceGenericErrors).toBe(1);
    expect(countSource('src/lib/x.ts', service).serviceGenericErrors).toBe(0);
  });

  it('refuses a grown count and reports a lowered one', () => {
    const empty = { routeWrites: {}, ormFallback: {}, routeErrorResponses: {}, serviceGenericErrors: {}, packageBoundary: {} };
    const baseline: ArchitectureBaseline = { ...empty, routeWrites: { 'a.ts': 2, 'b.ts': 1 } };
    const report = compareWithBaseline({ ...empty, routeWrites: { 'a.ts': 3, 'c.ts': 1 } }, baseline);
    expect(report.errors).toEqual([
      'routeWrites a.ts: 2 -> 3; move the write into a service (decision t2 B)',
      'routeWrites c.ts: 0 -> 1; move the write into a service (decision t2 B)',
    ]);
    expect(report.stale).toEqual(['routeWrites b.ts: 1 -> 0']);
  });

  it('the repository matches the baseline exactly', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), BASELINE_FILE), 'utf8')) as ArchitectureBaseline;
    const report = compareWithBaseline(currentState(), baseline);
    expect(report.errors).toEqual([]);
    expect(report.stale).toEqual([]);
    // Parses every production file; a loaded CI runner needs more than the 5 s default.
  }, 30_000);
});

describe('package_boundary_ratchet: server imports follow the package direction (decision t3 A)', () => {
  const rules = parsePackageMap('# map\n3  src/services/accounting/**\n14 src/services/workflow/**\n8  src/services/documents/**\n1  src/db/**\n2  src/middleware/**\n');

  it('reads the first matching rule of the map', () => {
    expect(packageOf(rules, 'src/services/accounting/voucher.service.ts')).toBe('3');
    expect(packageOf(rules, 'src/services/accounting/x/y.ts')).toBe('3');
    expect(packageOf(rules, 'src/services/crm/x.ts')).toBeNull();
  });

  it('allows imports towards a lower layer and between infrastructure packages only', () => {
    expect(importAllowed('8', '3')).toBe(true);
    expect(importAllowed('8', '14')).toBe(true);
    expect(importAllowed('14', '3')).toBe(true);
    expect(importAllowed('2', '1')).toBe(true);
    expect(importAllowed('3', '8')).toBe(false);
    expect(importAllowed('3', '14')).toBe(false);
    expect(importAllowed('14', '8')).toBe(false);
    expect(importAllowed('8', '9')).toBe(false);
    expect(importAllowed('3', '4')).toBe(false);
  });

  it('reads runtime imports, re-exports and dynamic imports, not type-only imports or packages', () => {
    const source = `
      import { a } from './a.js';
      import type { B } from './b';
      import { type C } from './c';
      import express from 'express';
      export { d } from '../d.js';
      const { e } = await import('./e.js');
    `;
    expect(importSpecifiers('src/x.ts', source)).toEqual(['./a.js', '../d.js', './e.js']);
  });

  it('the package map covers every server file', () => {
    expect(boundaryState().unmappedServerFiles).toEqual([]);
  });
});
