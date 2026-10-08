import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { webhookSubscriptions } from '../../db/schema.js';

/**
 * Tests isolate their webhook deliveries with an event type no other code publishes. Since v9.0.405 (TD-707) the service
 * accepts only «*» and published event types, so a test subscription is created with «*» and its patterns are then set
 * to the probe type directly.
 */
export async function setProbeEventPatterns(subscriptionId: number, patterns: string[]): Promise<void> {
  await orm.update(webhookSubscriptions).set({ eventPatterns: patterns }).where(eq(webhookSubscriptions.id, subscriptionId));
}
