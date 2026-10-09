import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';
import { buildRouteGuardTable } from '../../lib/routeGuardTable.js';
import { webhookEchoAnswer } from '../../services/events/webhookEcho.js';
import { EventSourcingReplayService } from '../../services/events/eventSourcingReplayService.js';

/**
 * Phase 3 lane L2, package 15 ledger (TD-997). OBS-R2-80: the webhook echo simulator answers only in test and
 * development; in production it is 404 without login (it answered there before). OBS-R2-79: the dead alias routes
 * `/action-rules/logs` and `/webhooks/deliveries`, shadowed by `/:id`, are gone. OBS-R2-84: the dry-run replay
 * evaluates the active rules of every event type ('*') too (it skipped them).
 */
export async function runEventsLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const idEcho = 'reg_webhook_echo_production_obs_r2_80';
  if (shouldRun(idEcho, 'obs-r2-80', 'events', 'package15')) {
    const name = 'v10.0.28: the webhook echo simulator is 404 in production (OBS-R2-80)';
    const tStart = Date.now();
    try {
      let outcome = 'answered';
      try {
        await webhookEchoAnswer({ method: 'POST', headers: {}, body: {} }, { ...process.env, NODE_ENV: 'production' });
      } catch (err) {
        outcome = `${(err as { statusCode?: number }).statusCode} ${(err as { code?: string }).code}`;
      }
      if (outcome !== '404 WEBHOOK_ECHO_UNAVAILABLE') throw new Error(`production echo: ${outcome}`);
      let wrongToken = 'answered';
      try {
        await webhookEchoAnswer({ method: 'POST', headers: { 'x-erp-signature-token': 'not-the-token' }, body: {} }, { ...process.env, NODE_ENV: 'test' });
      } catch (err) {
        wrongToken = String((err as { statusCode?: number }).statusCode);
      }
      if (wrongToken !== '401' && wrongToken !== '403') throw new Error(`wrong token in test: ${wrongToken}`);
      // the public route answers only through this gate
      const routes = readFileSync(resolve(process.cwd(), 'src/routes/events.routes.ts'), 'utf8');
      if (!routes.includes('webhookEchoAnswer({')) throw new Error('the /webhook-echo route does not go through webhookEchoAnswer');
      results.push(makeTestCase({ id: idEcho, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'production 404, wrong token refused' }));
    } catch (err) {
      results.push(makeTestCase({ id: idEcho, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const idAlias = 'reg_events_dead_alias_routes_obs_r2_79';
  if (shouldRun(idAlias, 'obs-r2-79', 'events', 'package15')) {
    const name = 'v10.0.29: the events routes register no alias shadowed by an /:id route (OBS-R2-79)';
    const tStart = Date.now();
    try {
      const { getTestApp } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const rows = buildRouteGuardTable(app as Parameters<typeof buildRouteGuardTable>[0]);
      const dead = rows.filter(r => r.method === 'GET' && (r.path === '/api/events/action-rules/logs' || r.path === '/api/events/webhooks/deliveries'))
        .map(r => `${r.method} ${r.path}`);
      if (dead.length > 0) throw new Error(`shadowed aliases still registered: ${dead.join(', ')}`);
      results.push(makeTestCase({ id: idAlias, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'no shadowed alias' }));
    } catch (err) {
      results.push(makeTestCase({ id: idAlias, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const idReplay = 'reg_replay_wildcard_rules_obs_r2_84';
  if (shouldRun(idReplay, 'obs-r2-84', 'events', 'package15')) {
    const name = 'v10.0.30: the dry-run replay evaluates the rules of every event type (OBS-R2-84)';
    const tStart = Date.now();
    let ruleId: number | null = null;
    try {
      const [rule] = await orm.insert(eventActionRules).values({
        name: `RR84-${Date.now()}`, eventType: '*', conditionsJson: [], actionType: 'audit_log', actionConfigJson: {}, isActive: 1,
      }).returning({ id: eventActionRules.id });
      ruleId = rule.id;
      const replay = await EventSourcingReplayService.simulateEventReplay({
        eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId: '1', payload: {}, dryRun: true,
      });
      const row = (replay.rulesBreakdown as Array<{ ruleId: number; matched: boolean }>).find(r => r.ruleId === ruleId);
      if (!row) throw new Error(`the '*' rule was not evaluated (${replay.evaluatedRulesCount} rules)`);
      if (!row.matched) throw new Error('the unconditional * rule did not match');
      const replaySource = readFileSync(resolve(process.cwd(), 'src/services/events/eventSourcingReplayService.ts'), 'utf8');
      if (replaySource.includes('params.userId || 1')) throw new Error('a replay without a user is still recorded as user 1');
      results.push(makeTestCase({ id: idReplay, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'the * rule is evaluated and matches' }));
    } catch (err) {
      results.push(makeTestCase({ id: idReplay, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (ruleId !== null) await orm.delete(eventActionRules).where(eq(eventActionRules.id, ruleId));
    }
  }

  return results;
}
