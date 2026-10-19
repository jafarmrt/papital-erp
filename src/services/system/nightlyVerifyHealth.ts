import fs from 'fs';
import path from 'path';
import {
  NIGHTLY_VERIFY_MESSAGES, nightlyVerifyVerdict, parseNightlyReport, type NightlyVerifyHealth,
} from '../../lib/system/nightlyVerify.js';

export type { NightlyVerifyHealth };

/**
 * The report `scripts/nightly-verify.sh` writes: NIGHTLY_VERIFY_REPORT (the script reads it from its environment, else
 * from the app's .env, the same value the service gets), else logs/nightly-verify.json of the app.
 */
export function nightlyVerifyReportPath(): string {
  return process.env.NIGHTLY_VERIFY_REPORT || path.join(process.cwd(), 'logs', 'nightly-verify.json');
}

/**
 * v10.2.16 (O-04): the nightly backup check card of the health page. No file is «not run yet»; a file that cannot be
 * read or is not a report is `unknown`, never `ok`.
 */
export function readNightlyVerifyHealth(now: Date = new Date()): NightlyVerifyHealth {
  const file = nightlyVerifyReportPath();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return nightlyVerifyVerdict(null, now);
    return unknown();
  }
  const report = parseNightlyReport(text);
  return report ? nightlyVerifyVerdict(report, now) : unknown();
}

function unknown(): NightlyVerifyHealth {
  return {
    status: 'unknown', finishedAt: null, backupFile: null, backupAt: null, failure: null, healthErrorCount: null, healthWarningCount: null,
    invariantViolationCount: null, worse: [], acceptedWorse: [], messages: [NIGHTLY_VERIFY_MESSAGES.unknown],
  };
}
