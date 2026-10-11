import { describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { bootDegradedSteps, runBootSequence, type BootStep } from '../../services/system/bootSequence.js';
import { bootDataSteps } from '../../services/system/bootData.js';

const noSleep = { sleep: async () => {}, attempts: 3 };
const step = (name: string, essential: boolean, run: () => Promise<void>): BootStep => ({ name, essential, run });

/**
 * v10.0.180 (TD-958, OBS-R1-01): before, `server.ts` ran every boot data step in one five-attempt loop, so a
 * non-essential step that kept failing (base data, default engines, the time zone cache) stopped the whole process.
 */
describe('startup sequence: essential and non-essential steps (TD-958)', () => {
  it('only the migrations are essential among the boot data steps', () => {
    const steps = bootDataSteps();
    expect(steps.filter(s => s.essential).map(s => s.name)).toEqual(['migrations']);
    expect(steps.length).toBeGreaterThan(1);
  });

  it('a non-essential step that keeps failing is left out and the later steps still run', async () => {
    const later = vi.fn(async () => {});
    const failing = vi.fn(async () => { throw new Error('seed broke'); });
    const report = await runBootSequence([
      step('migrations', true, async () => {}),
      step('base data seed', false, failing),
      step('display time zone cache', false, later),
    ], noSleep);
    expect(report.fatal).toBeNull();
    expect(report.ok).toBe(false);
    expect(report.degraded).toEqual([{ step: 'base data seed', error: 'seed broke' }]);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(later).toHaveBeenCalledTimes(1);
    expect(bootDegradedSteps()).toEqual([{ step: 'base data seed', error: 'seed broke' }]);
  });

  it('an essential step that keeps failing is fatal and nothing after it runs', async () => {
    const later = vi.fn(async () => {});
    const report = await runBootSequence([
      step('migrations', true, async () => { throw new Error('no schema'); }),
      step('base data seed', false, later),
    ], noSleep);
    expect(report.fatal).toEqual({ step: 'migrations', error: 'no schema' });
    expect(later).not.toHaveBeenCalled();
  });

  it('a step that succeeds on a later attempt is not reported', async () => {
    let calls = 0;
    const report = await runBootSequence([
      step('base data seed', false, async () => { if (++calls < 2) throw new Error('busy'); }),
    ], noSleep);
    expect(report).toEqual({ ok: true, fatal: null, degraded: [] });
    expect(bootDegradedSteps()).toEqual([]);
  });
});
