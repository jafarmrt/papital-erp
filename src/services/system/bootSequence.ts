import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils.js';

/**
 * v10.0.21 (TD-958, OBS-R1-01): the background startup of `server.ts` as separate steps. An essential step (the
 * migrations) that still fails after its attempts stops the process, as before; a non-essential step (base data,
 * default engines, the display time zone cache) that still fails is recorded and the server starts without it, so one
 * failing extra no longer takes the whole system down. The steps left out are listed by `/health/ready` and
 * `/health/startup` (`degradedSteps`) and in the error log. Terminal output is English (AGENTS.md, owner rule t9).
 */
export interface BootStep {
  name: string;
  essential: boolean;
  run(): Promise<void>;
}

export interface BootStepFailure {
  step: string;
  error: string;
}

export interface BootReport {
  ok: boolean;
  /** an essential step failed: the caller stops the process */
  fatal: BootStepFailure | null;
  degraded: BootStepFailure[];
}

export interface BootOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

let degradedSteps: BootStepFailure[] = [];

/** Non-essential startup steps that failed at the last boot (empty when every step succeeded). */
export function bootDegradedSteps(): BootStepFailure[] {
  return degradedSteps.map(s => ({ ...s }));
}

export async function runBootSequence(steps: BootStep[], options: BootOptions = {}): Promise<BootReport> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 1500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const degraded: BootStepFailure[] = [];
  for (const step of steps) {
    let lastError = '';
    let done = false;
    for (let attempt = 1; attempt <= attempts && !done; attempt++) {
      try {
        await step.run();
        done = true;
      } catch (err) {
        lastError = errorMessageOf(err);
        logger.error(`Startup step "${step.name}" failed (attempt ${attempt}/${attempts}): ${lastError}`);
        if (attempt < attempts) await sleep(delayMs);
      }
    }
    if (done) continue;
    const failure = { step: step.name, error: lastError };
    if (step.essential) {
      degradedSteps = degraded;
      return { ok: false, fatal: failure, degraded };
    }
    logger.error(`Startup step "${step.name}" left out after ${attempts} attempts; the server starts without it`);
    degraded.push(failure);
  }
  degradedSteps = degraded;
  return { ok: degraded.length === 0, fatal: null, degraded };
}
