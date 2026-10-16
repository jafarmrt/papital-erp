import fs from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { runMigrations, type MigrationResult } from '../../db/migrator.js';
import { deadLetterEvents, idempotencyKeys, outboxEvents } from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS, ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { OutboxService } from '../../services/events/outboxService.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Closing sweep, operational observations: each test is red on v10.1.45.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

/** Rows of one sweep run: two expired and one live idempotency key, and outbox events in every state. */
async function seedSweepRows(tag: string) {
  const keys = await orm.insert(idempotencyKeys).values([
    { key: `ops-expired-a-${tag}`, scope: 'ops_sweep', status: 'completed', expiresAt: isoDaysAgo(2) },
    { key: `ops-expired-b-${tag}`, scope: 'ops_sweep', status: 'completed', expiresAt: isoDaysAgo(1) },
    { key: `ops-live-${tag}`, scope: 'ops_sweep', status: 'completed', expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
  ]).returning({ id: idempotencyKeys.id, key: idempotencyKeys.key });
  const event = (name: string, status: string, processedDaysAgo: number | null) => ({
    eventId: `ops-${name}-${tag}`, eventType: 'OpsSweepProbe', aggregateType: 'ops_sweep', aggregateId: tag, status,
    processedAt: processedDaysAgo === null ? null : isoDaysAgo(processedDaysAgo),
  });
  const events = await orm.insert(outboxEvents).values([
    event('old-completed', 'completed', 120),
    event('old-completed-quarantined', 'completed', 120),
    event('new-completed', 'completed', 30),
    event('old-failed', 'failed', 120),
    event('old-processing', 'processing', 120),
    event('pending', 'pending', null),
  ]).returning({ id: outboxEvents.id, eventId: outboxEvents.eventId });
  // a dead-letter row not yet replayed keeps its completed outbox row: a replay reads its completed handlers
  const [dead] = await orm.insert(deadLetterEvents).values({
    originalEventId: `ops-old-completed-quarantined-${tag}`, eventType: 'OpsSweepProbe', aggregateType: 'ops_sweep',
    aggregateId: tag, failureReason: 'ops sweep probe', status: 'quarantined',
  }).returning({ id: deadLetterEvents.id });
  return { keys, events, deadId: dead.id };
}

export async function runOpsSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const purgeId = 'reg_operational_purge_obs_r2_10';
  if (shouldRun(purgeId, 'obs-r2-10', 'idempotency', 'outbox', 'purge')) {
    await runCase(results, purgeId, 'closing sweep: the daily purge deletes expired idempotency keys and completed outbox events older than 90 days, nothing else (OBS-R2-10)', async () => {
      const tag = tagOf();
      const { keys, events, deadId } = await seedSweepRows(tag);
      const { OperationalPurgeService } = await import('../../services/events/operationalPurge.service.js');
      const purged = await OperationalPurgeService.purgeOnce();

      const keptKeys = new Set((await orm.select({ key: idempotencyKeys.key }).from(idempotencyKeys)
        .where(inArray(idempotencyKeys.id, keys.map(k => k.id)))).map(r => r.key));
      const keptEvents = new Set((await orm.select({ eventId: outboxEvents.eventId }).from(outboxEvents)
        .where(inArray(outboxEvents.id, events.map(e => e.id)))).map(r => r.eventId));
      const deadKept = (await orm.select({ id: deadLetterEvents.id }).from(deadLetterEvents).where(inArray(deadLetterEvents.id, [deadId]))).length === 1;

      const expectKept = (set: Set<string>, name: string, kept: boolean) => set.has(name) === kept ? [] : [`${name} was ${kept ? 'deleted' : 'kept'}`];
      assertNoProblems([
        ...expectKept(keptKeys, `ops-expired-a-${tag}`, false),
        ...expectKept(keptKeys, `ops-expired-b-${tag}`, false),
        ...expectKept(keptKeys, `ops-live-${tag}`, true),
        ...expectKept(keptEvents, `ops-old-completed-${tag}`, false),
        ...expectKept(keptEvents, `ops-old-completed-quarantined-${tag}`, true),
        ...expectKept(keptEvents, `ops-new-completed-${tag}`, true),
        ...expectKept(keptEvents, `ops-old-failed-${tag}`, true),
        ...expectKept(keptEvents, `ops-old-processing-${tag}`, true),
        ...expectKept(keptEvents, `ops-pending-${tag}`, true),
        ...(deadKept ? [] : ['the dead-letter row was deleted']),
        // other tests of the schema may leave expired keys or old events too, so the counts are at least ours
        ...(purged.idempotencyKeys >= 2 ? [] : [`reported ${purged.idempotencyKeys} deleted idempotency key(s), expected at least 2`]),
        ...(purged.outboxEvents >= 1 ? [] : [`reported ${purged.outboxEvents} deleted outbox event(s), expected at least 1`]),
      ]);
      return `deleted ${purged.idempotencyKeys} key(s) and ${purged.outboxEvents} event(s); live key, recent, failed, processing, pending and quarantined events kept`;
    });
  }

  const countId = 'reg_operational_purge_counts_obs_r2_10';
  if (shouldRun(countId, 'obs-r2-10', 'idempotency', 'outbox', 'purge')) {
    await runCase(results, countId, 'closing sweep: both purges report the real number of deleted rows and keep a completed event its dead-letter row still needs (OBS-R2-10)', async () => {
      const tag = tagOf();
      const { events } = await seedSweepRows(tag);
      const keysDeleted = await IdempotencyService.cleanupExpired();
      const eventsDeleted = await OutboxService.purgeProcessedEvents(90);
      const keptEvents = new Set((await orm.select({ eventId: outboxEvents.eventId }).from(outboxEvents)
        .where(inArray(outboxEvents.id, events.map(e => e.id)))).map(r => r.eventId));
      assertNoProblems([
        ...(keysDeleted >= 2 ? [] : [`cleanupExpired reported ${keysDeleted}, expected at least 2`]),
        ...(eventsDeleted >= 1 ? [] : [`purgeProcessedEvents reported ${eventsDeleted}, expected at least 1`]),
        ...(keptEvents.has(`ops-old-completed-quarantined-${tag}`) ? [] : ['the completed event of an unreplayed dead-letter row was deleted']),
      ]);
      return `cleanupExpired ${keysDeleted}, purgeProcessedEvents ${eventsDeleted}`;
    });
  }

  const batchId = 'reg_operational_purge_batches_obs_r2_10';
  if (shouldRun(batchId, 'obs-r2-10', 'idempotency', 'outbox', 'purge', 'batch')) {
    await runCase(results, batchId, 'closing sweep: both purges delete a backlog larger than one batch in several statements and count every row (OBS-R2-10 review)', async () => {
      const tag = tagOf();
      const backlog = 7;
      const batchSize = 3;
      const keys = await orm.insert(idempotencyKeys).values(Array.from({ length: backlog }, (_, i) => (
        { key: `ops-batch-expired-${i}-${tag}`, scope: 'ops_sweep', status: 'completed', expiresAt: isoDaysAgo(1) }
      ))).returning({ id: idempotencyKeys.id });
      const events = await orm.insert(outboxEvents).values(Array.from({ length: backlog }, (_, i) => ({
        eventId: `ops-batch-old-${i}-${tag}`, eventType: 'OpsSweepProbe', aggregateType: 'ops_sweep', aggregateId: tag,
        status: 'completed', processedAt: isoDaysAgo(120),
      }))).returning({ id: outboxEvents.id });
      const [live] = await orm.insert(outboxEvents).values({
        eventId: `ops-batch-pending-${tag}`, eventType: 'OpsSweepProbe', aggregateType: 'ops_sweep', aggregateId: tag, status: 'pending',
      }).returning({ id: outboxEvents.id });
      const keysDeleted = await IdempotencyService.cleanupExpired(batchSize);
      const eventsDeleted = await OutboxService.purgeProcessedEvents(90, batchSize);
      const keysLeft = (await orm.select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(inArray(idempotencyKeys.id, keys.map(k => k.id)))).length;
      const eventsLeft = (await orm.select({ id: outboxEvents.id }).from(outboxEvents).where(inArray(outboxEvents.id, events.map(e => e.id)))).length;
      const liveKept = (await orm.select({ id: outboxEvents.id }).from(outboxEvents).where(inArray(outboxEvents.id, [live.id]))).length === 1;
      assertNoProblems([
        ...(keysLeft === 0 ? [] : [`${keysLeft} of ${backlog} expired keys were left after batches of ${batchSize}`]),
        ...(eventsLeft === 0 ? [] : [`${eventsLeft} of ${backlog} old completed events were left after batches of ${batchSize}`]),
        ...(keysDeleted >= backlog ? [] : [`cleanupExpired counted ${keysDeleted}, expected at least ${backlog}`]),
        ...(eventsDeleted >= backlog ? [] : [`purgeProcessedEvents counted ${eventsDeleted}, expected at least ${backlog}`]),
        ...(liveKept ? [] : ['a pending event was deleted']),
      ]);
      return `batches of ${batchSize}: ${keysDeleted} key(s) and ${eventsDeleted} event(s) deleted, pending event kept`;
    });
  }

  const wiringId = 'reg_operational_purge_scheduled_obs_r2_10';
  if (shouldRun(wiringId, 'obs-r2-10', 'purge', 'advisory')) {
    await runCase(results, wiringId, 'closing sweep: the server starts and stops the daily purge under its own advisory lock key (OBS-R2-10)', async () => {
      const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      const lockKeys = Object.values(ADVISORY_LOCK_KEYS as Record<string, number>);
      const allKeys = [...lockKeys, ...Object.values(ROW_ADVISORY_LOCK_NAMESPACES as Record<string, number>)];
      const purgeKey = (ADVISORY_LOCK_KEYS as Record<string, number>).OPERATIONAL_PURGE;
      assertNoProblems([
        ...(/OperationalPurgeService\.start\(/.test(server) ? [] : ['server.ts never starts the operational purge']),
        ...(/OperationalPurgeService\.stop\(/.test(server) ? [] : ['server.ts never stops the operational purge']),
        ...(purgeKey === 91100 ? [] : [`OPERATIONAL_PURGE lock key is ${purgeKey}, expected 91100`]),
        ...(new Set(allKeys).size === allKeys.length ? [] : ['two advisory lock keys share one number']),
      ]);
      return 'started and stopped in server.ts, lock 91100';
    });
  }

  const lockId = 'reg_migration_lock_wait_bounded_obs_pr_10';
  if (shouldRun(lockId, 'obs-pr-10', 'migration', 'lock', 'advisory')) {
    await runCase(results, lockId, 'closing sweep: a migration run waits for lock 91008 only up to MIGRATION_LOCK_TIMEOUT and reports a clear failure (OBS-PR-10)', async () => {
      const holder = await pool.connect();
      const previous = process.env.MIGRATION_LOCK_TIMEOUT;
      let run: Promise<MigrationResult> | null = null;
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await holder.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEYS.MIGRATIONS]).catch(() => undefined);
      };
      try {
        await holder.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEYS.MIGRATIONS]);
        process.env.MIGRATION_LOCK_TIMEOUT = '300ms';
        const started = Date.now();
        run = runMigrations();
        // the old migrator waits forever: give it 15 seconds, then release the lock so the run can finish
        const hung = Symbol('hung');
        const outcome = await Promise.race([run, new Promise<typeof hung>(resolve => setTimeout(() => resolve(hung), 15_000))]);
        if (outcome === hung) throw new Error('the migration run still waited for lock 91008 after 15 seconds');
        const elapsed = Date.now() - started;
        const message = outcome.errors.join(' ');
        await release();
        process.env.MIGRATION_LOCK_TIMEOUT = previous ?? '';
        const after = await runMigrations();
        const settings = await pool.query<{ lt: string }>("SELECT current_setting('lock_timeout') AS lt");
        assertNoProblems([
          ...(outcome.success ? ['a run that never got lock 91008 was reported successful'] : []),
          ...(message.includes('91008') ? [] : [`the error does not name lock 91008: ${message}`]),
          ...(elapsed < 10_000 ? [] : [`the run gave up after ${elapsed} ms, not near the 300 ms timeout`]),
          ...(after.success ? [] : [`a run after the lock was released failed: ${after.errors.join('; ')}`]),
          ...(settings.rows[0]?.lt === '0' ? [] : [`a pool connection kept lock_timeout ${settings.rows[0]?.lt}`]),
        ]);
        return `refused after ${elapsed} ms naming lock 91008; the next run succeeded`;
      } finally {
        await release();
        if (previous === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT;
        else process.env.MIGRATION_LOCK_TIMEOUT = previous;
        if (run) await run.catch(() => undefined);
        holder.release();
      }
    });
  }

  return results;
}
