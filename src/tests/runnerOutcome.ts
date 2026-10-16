import type { ExecutionType } from './types.js';

/**
 * The exit code and the real-execution count of a `scripts/run-tests.ts` run, shared by every output mode.
 * OBS-R1-23: `--json` exits non-zero on a failed test too, like the text output.
 * OBS-R2-114: real execution counts every case that ran real code (database, API or code), never only `real_code`.
 */

/** Execution types that ran the application's own code; only `simulation_logic` is not real execution */
export const REAL_EXECUTION_TYPES: ReadonlySet<ExecutionType> = new Set<ExecutionType>(['real_database', 'real_api', 'real_code']);

/** Number of cases that ran real code */
export function realExecutionCount(cases: ReadonlyArray<{ executionType: ExecutionType }>): number {
  return cases.filter(c => REAL_EXECUTION_TYPES.has(c.executionType)).length;
}

/** 1 when no test ran, any test failed or the run did not pass as a whole; else 0 */
export function runnerExitCode(report: { totalTests: number; failedCount: number; overallStatus: string }): 0 | 1 {
  if (report.totalTests === 0) return 1;
  if (report.failedCount > 0) return 1;
  return report.overallStatus === 'passed' ? 0 : 1;
}
