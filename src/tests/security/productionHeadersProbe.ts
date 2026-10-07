/**
 * Prints the security headers of the real Express app built in this process, as one JSON line.
 * Run by `checkProductionCsp` (edgeHardeningChecks.ts) with NODE_ENV=production in a separate process,
 * because createApp() reads NODE_ENV when it builds the helmet policy (TD-597).
 */
import request from 'supertest';
import { createApp } from '../../app.js';

async function main(): Promise<void> {
  const app = await createApp();
  const r = await request(app).get('/health/live');
  console.log(`PROBE ${JSON.stringify({ status: r.status, csp: r.headers['content-security-policy'] ?? '' })}`);
}

main().then(() => process.exit(0), (err: unknown) => {
  console.error(`PROBE_ERROR ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
