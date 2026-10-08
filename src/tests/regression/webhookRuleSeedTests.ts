import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { eventActionRules } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-715 / B15-13 (decision t4 a): server start never rewrites existing automatic
 * rules, and the system's own echo token is sent only to this server's echo simulator. On v9.0.356 every start turned a
 * rule URL containing "example.com" anywhere into the local echo address and copied the system token into every webhook
 * rule without one, which then sent it to the rule's external address.
 */
export async function runWebhookRuleSeedTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_rules_not_rewritten_at_boot_td_715';
  if (!shouldRun(id, 'td715', 'b15-13', 'webhook', 'seed', 'package15')) return results;

  const name = 'v9.0.357: server start leaves webhook rules as saved and the system echo token never goes to another address (TD-715)';
  const tStart = Date.now();
  const ruleIds: number[] = [];
  const realFetch = globalThis.fetch;
  try {
    const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
    const wrong: string[] = [];
    const saved = [
      { name: 'TD715 partner accounting', url: 'https://erp.example.com.ir/hooks/invoice' },
      { name: 'TD715 partner warehouse', url: 'https://partner-logistics.ir/hook' },
    ];
    for (const rule of saved) {
      const [row] = await orm.insert(eventActionRules).values({
        name: rule.name, eventType: 'InvoiceApproved', actionType: 'webhook', actionConfigJson: { url: rule.url },
      }).returning({ id: eventActionRules.id });
      ruleIds.push(row.id);
    }

    // 1. the start-up seed (server.ts) leaves saved rules exactly as they are
    await EventActionEngineService.seedDefaultRules();
    const after = await orm.select().from(eventActionRules).where(inArray(eventActionRules.id, ruleIds));
    for (const rule of saved) {
      const row = after.find(r => r.name === rule.name);
      const cfg = (row?.actionConfigJson ?? {}) as Record<string, unknown>;
      if (cfg.url !== rule.url || cfg.secretToken !== undefined) wrong.push(`«${rule.name}» rewritten at start: ${JSON.stringify(cfg)}`);
    }

    // 2. the system echo token goes only to the echo simulator; a rule's own token goes to its address
    const systemToken = await EventActionEngineService.getWebhookSecretToken();
    const sent: Array<{ url: string; token: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({ url: String(input), token: headers.get('X-ERP-Signature-Token') });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const event = {
      eventId: `td715-${Date.now()}`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '715',
      payload: {}, metadata: {}, occurredAt: new Date().toISOString(),
    } as unknown as Parameters<typeof EventActionEngineService.executeAction>[1];
    const ruleOf = (url: string, secretToken: string) => ({
      id: 0, name: 'TD715 rule', actionType: 'webhook', actionConfigJson: { url, secretToken },
    }) as unknown as Parameters<typeof EventActionEngineService.executeAction>[0];
    const echoUrl = `http://127.0.0.1:${process.env.PORT || 3000}/api/events/webhook-echo`;
    const outside = await EventActionEngineService.executeAction(ruleOf('https://partner.example.com/hook', systemToken), event);
    await EventActionEngineService.executeAction(ruleOf('https://partner.example.com/hook', 'partner-token-715'), event);
    await EventActionEngineService.executeAction(ruleOf(echoUrl, systemToken), event);
    const [toPartner, ownToken, toEcho] = sent;
    if (!toPartner || toPartner.token !== null) wrong.push(`system token sent to the partner address: ${JSON.stringify(toPartner)}`);
    if (!(outside.result as { systemTokenWithheld?: boolean })?.systemTokenWithheld) wrong.push(`result does not say the token was withheld: ${JSON.stringify(outside.result)}`);
    if (ownToken?.token !== 'partner-token-715') wrong.push(`rule token not sent: ${JSON.stringify(ownToken)}`);
    if (toEcho?.token !== systemToken) wrong.push(`system token not sent to the echo simulator: ${JSON.stringify(toEcho?.url)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'seed leaves saved rules unchanged; system token withheld from an external address, sent to the echo simulator; a rule token is sent',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    globalThis.fetch = realFetch;
    if (ruleIds.length > 0) await orm.delete(eventActionRules).where(inArray(eventActionRules.id, ruleIds));
  }
  return results;
}
