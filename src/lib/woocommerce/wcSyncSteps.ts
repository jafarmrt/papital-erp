/**
 * 10.2 package 6 (D-04 part C, review N-13): the WooCommerce worker's steps run one after the other, and a step that fails,
 * by its outcome or by throwing, never keeps the next step from running. Terminal output is English (AGENTS §6).
 */
export interface WcSyncStep {
  name: string;
  run: () => Promise<{ state: string; result?: { syncedCount: number; failedCount: number } }>;
}

export interface WcSyncLog {
  info: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
}

async function runStep(step: WcSyncStep, log: WcSyncLog): Promise<void> {
  try {
    const outcome = await step.run();
    if (outcome.result) {
      log.info(`[WooCommerce ${step.name}] ${outcome.result.syncedCount} product(s) updated, ${outcome.result.failedCount} failed`);
    } else if (outcome.state === 'failed') {
      log.warn(`[WooCommerce ${step.name}] Run failed; the next attempt waits (see the WooCommerce tab)`);
    } else if (outcome.state === 'read') {
      log.info(`[WooCommerce ${step.name}] The shop catalog was read`);
    }
  } catch (err) {
    log.error(`[WooCommerce ${step.name}] Run failed: ${err instanceof Error ? err.name : 'unknown error'}`);
  }
}

export async function runSyncSteps(steps: readonly WcSyncStep[], log: WcSyncLog): Promise<void> {
  for (const step of steps) await runStep(step, log);
}
