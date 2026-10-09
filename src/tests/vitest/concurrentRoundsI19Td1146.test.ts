import { describe, expect, it, vi } from 'vitest';

const { over, FakeAppError } = vi.hoisted(() => ({
  over: { now: [] as Array<{ itemId: number; stock: string; reserved: string }> },
  FakeAppError: class FakeAppError extends Error {},
}));
vi.mock('../../errors/customErrors.js', () => ({ AppError: FakeAppError }));
vi.mock('../invariants/businessInvariants.js', () => ({ checkBusinessInvariants: vi.fn(async () => []) }));
vi.mock('../invariants/concurrencyHarness.js', () => ({ isDeadlock: () => false }));
vi.mock('../simulation/simulationOperations.js', () => ({ isoDay: (d: number) => `2025-01-${String(d).padStart(2, '0')}` }));
vi.mock('../invariants/reservationInvariants.js', () => ({
  overReservedItems: vi.fn(async () => over.now),
  checkReservationWithinStock: vi.fn(async () => over.now.map(o => ({ invariant: 'I19_reservation_within_stock', key: `item:${o.itemId}`, message: 'over' }))),
}));

import { runConcurrentRounds } from '../simulation/simulationConcurrentRounds';
import type { SimOperation } from '../simulation/businessYearSimulator';

/** One run of `rounds`: each round's ops, and the over-reserved items the round leaves behind */
async function run(rounds: Array<{ ops: SimOperation[]; leaves: Array<{ itemId: number; stock: string; reserved: string }> }>) {
  const findings: string[] = [];
  const queue = rounds.flatMap(r => r.ops);
  let picked = 0;
  let roundIndex = 0;
  let inRound = 0;
  await runConcurrentRounds({
    users: rounds[0].ops.length, steps: queue.length, checkEvery: 99, scope: { itemIds: [1, 2] } as never,
    reservationGuarded: new Set<SimOperation>(['remittance', 'sale', 'proforma_approval']),
    nextDay: () => 1, backDayOf: d => d, pickOp: () => queue[picked++], chance: () => false,
    runOp: async () => {
      const r = rounds[roundIndex];
      if (++inRound === r.ops.length) { over.now = r.leaves; roundIndex++; inRound = 0; }
      return { detail: 'done', tags: [] };
    },
    records: [], addFinding: v => findings.push(`${v.invariant} ${v.key}`), log: () => undefined,
  });
  return findings;
}

describe('v10.0.39 (TD-1146): the concurrent simulator reports I19 only for a reservation the round itself pushed over stock', () => {
  it('does not report a round whose stock count or void lowered stock below a reservation (TD-819)', async () => {
    over.now = [];
    expect(await run([{ ops: ['remittance', 'stock_count'], leaves: [{ itemId: 1, stock: '2', reserved: '3' }] }])).toEqual([]);
    over.now = [];
    expect(await run([{ ops: ['void', 'proforma_approval'], leaves: [{ itemId: 2, stock: '0', reserved: '1' }] }])).toEqual([]);
  });

  it('does not report an excess an earlier round left behind while it does not grow', async () => {
    over.now = [];
    expect(await run([
      { ops: ['stock_count', 'remittance'], leaves: [{ itemId: 1, stock: '2', reserved: '3' }] },
      { ops: ['remittance', 'sale'], leaves: [{ itemId: 1, stock: '2', reserved: '3' }] },
    ])).toEqual([]);
  });

  it('still reports a guarded round that leaves a new or a larger excess', async () => {
    over.now = [];
    expect(await run([{ ops: ['remittance', 'sale'], leaves: [{ itemId: 2, stock: '1', reserved: '2' }] }])).toEqual(['I19_reservation_within_stock item:2']);
    over.now = [];
    expect(await run([
      { ops: ['stock_count', 'remittance'], leaves: [{ itemId: 1, stock: '2', reserved: '3' }] },
      { ops: ['remittance', 'sale'], leaves: [{ itemId: 1, stock: '1', reserved: '3' }] },
    ])).toEqual(['I19_reservation_within_stock item:1']);
  });
});
