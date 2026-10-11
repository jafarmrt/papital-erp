import { AppError } from '../../errors/customErrors.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { checkBusinessInvariants, type InvariantScope, type InvariantViolation } from '../invariants/businessInvariants.js';
import { isDeadlock } from '../invariants/concurrencyHarness.js';
import { fin } from '../../lib/financialDecimal.js';
import { overReservedItems, type OverReservedItem } from '../invariants/reservationInvariants.js';
import type { SimOperation, SimStepRecord } from './businessYearSimulator.js';
import { isoDay, type OpOutcome } from './simulationOperations.js';

/**
 * v10.0.36 (I-03): the simulator's steps run in rounds of `users` operations at once, as that many people using the
 * workshop at the same moment would. A round's operations are picked with the seed, then started together; their order
 * on the database is not fixed. A business refusal (`AppError`) is an allowed outcome, a deadlock or any other error is a
 * finding, and reservations stay within stock after every round with a sellable-gated operation (I19; since v10.0.40,
 * TD-1146, only an excess the round itself created or raised, in a round without a stock count or a void). The invariants
 * run after every `checkEvery` rounds and after the last one.
 */
export interface ConcurrentRoundsContext {
  users: number;
  steps: number;
  checkEvery: number;
  stopOnFirstViolation?: boolean;
  scope: InvariantScope;
  /** operations that pass the sellable gate, after which reservations must stay within stock (I19) */
  reservationGuarded: ReadonlySet<SimOperation>;
  nextDay: () => number;
  backDayOf: (day: number) => number;
  pickOp: () => SimOperation;
  chance: (p: number) => boolean;
  runOp: (op: SimOperation, day: number, backDay: number, backdatePermitted: boolean) => Promise<OpOutcome>;
  records: SimStepRecord[];
  addFinding: (v: InvariantViolation, step: number, op: SimOperation | 'setup') => void;
  log: (line: string) => void;
}

interface PlannedStep { step: number; op: SimOperation; day: number; backDay: number; permitted: boolean }

/**
 * v10.0.40 (TD-1146): operations that may lower stock below a reservation without the sellable gate (TD-819). A round in
 * which one of them succeeds is not checked for I19, because its order against the round's guarded operations is not
 * fixed; the excess it leaves is the baseline of the next round.
 */
const UNGUARDED_STOCK_LOWERING: ReadonlySet<SimOperation> = new Set<SimOperation>(['stock_count', 'void']);

const excessOf = (o: OverReservedItem) => fin(o.reserved).subtract(fin(o.stock));

export async function runConcurrentRounds(ctx: ConcurrentRoundsContext): Promise<void> {
  let step = 0;
  // I19 excess per item left by the rounds before; a round reports only an excess it created or raised
  let excessBefore = new Map((await overReservedItems(ctx.scope.itemIds)).map(o => [o.itemId, excessOf(o)]));
  for (let round = 1; step < ctx.steps; round++) {
    const batch: PlannedStep[] = [];
    while (batch.length < ctx.users && step < ctx.steps) {
      step++;
      const day = ctx.nextDay();
      const op = ctx.pickOp();
      batch.push({ step, op, day, backDay: ctx.backDayOf(day), permitted: op.startsWith('backdated_') && ctx.chance(0.5) });
    }
    const settled = await Promise.allSettled(batch.map(b => ctx.runOp(b.op, b.day, b.backDay, b.permitted)));
    let guardedOk = false;
    let loweredUnguarded = false;
    settled.forEach((res, i) => {
      const b = batch[i];
      let record: SimStepRecord;
      if (res.status === 'fulfilled') {
        const tags = b.op.startsWith('backdated_') ? [...res.value.tags, 'backdated', ...(b.permitted ? ['permitted'] : [])] : res.value.tags;
        const skipped = res.value.detail.startsWith('skip:');
        record = { step: b.step, op: b.op, date: isoDay(b.day), outcome: skipped ? 'skipped' : 'ok', detail: res.value.detail, tags: [...tags, 'concurrent'] };
        if (!skipped && ctx.reservationGuarded.has(b.op)) guardedOk = true;
        if (!skipped && UNGUARDED_STOCK_LOWERING.has(b.op)) loweredUnguarded = true;
      } else {
        const message = getErrorMessage(res.reason);
        record = { step: b.step, op: b.op, date: isoDay(b.day), outcome: 'rejected', detail: message.slice(0, 300), tags: ['concurrent'] };
        if (isDeadlock(res.reason)) {
          ctx.addFinding({ invariant: 'I0_deadlock', key: b.op, message: `operation ${b.op} failed with a deadlock (40P01) in a round of ${batch.length}` }, b.step, b.op);
        } else if (!(res.reason instanceof AppError)) {
          ctx.addFinding({ invariant: 'I0_unexpected_error', key: `${b.op}:${message.slice(0, 80)}`, message: `operation ${b.op} failed with a non-business error in a round of ${batch.length}: ${message.slice(0, 200)}` }, b.step, b.op);
        }
      }
      ctx.records.push(record);
      ctx.log(`#${record.step} r${round} ${record.date} ${record.op} ${record.outcome}: ${record.detail}`);
    });
    const last = batch[batch.length - 1];
    if (guardedOk) {
      const over = await overReservedItems(ctx.scope.itemIds);
      if (!loweredUnguarded) {
        for (const o of over) {
          const before = excessBefore.get(o.itemId);
          if (before && !excessOf(o).greaterThan(before)) continue;
          ctx.addFinding({
            invariant: 'I19_reservation_within_stock', key: `item:${o.itemId}`, message: `Reservations of item ${o.itemId} exceed its stock`,
            expected: `<= ${o.stock}`, actual: o.reserved,
          }, last.step, last.op);
        }
      }
      excessBefore = new Map(over.map(o => [o.itemId, excessOf(o)]));
    } else if (loweredUnguarded) {
      excessBefore = new Map((await overReservedItems(ctx.scope.itemIds)).map(o => [o.itemId, excessOf(o)]));
    }
    if (round % ctx.checkEvery === 0 || step >= ctx.steps) {
      const violations = await checkBusinessInvariants(ctx.scope);
      for (const v of violations) ctx.addFinding(v, last.step, last.op);
      if (ctx.stopOnFirstViolation && violations.length > 0) return;
    }
  }
}
