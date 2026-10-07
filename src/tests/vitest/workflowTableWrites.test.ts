import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * v9.0.269 (TD-692، B10-05؛ A02-03، A02-04، A02-08): جدول‌های گردش‌کار را فقط موتور گردش‌کار می‌نویسد
 * (`src/services/workflow/`)؛ دامنه‌ها گام را با `executeTransition` جابه‌جا و فرایند را با `terminateOpenWorkflows` می‌بندند.
 * پیش‌تر تحویل تدارکات وقتی انتقال «دریافت کالا» شکست می‌خورد، `workflow_instances` را مستقیم COMPLETED می‌کرد،
 * `workflow_pending_approvals` را فیزیکی حذف و `workflow_tasks` را می‌بست، و تبدیل به سفارش گام را مستقیم می‌نوشت.
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const ALLOWED_DIRS = ['src/services/workflow/', 'src/tests/', 'src/db/'];

const WORKFLOW_TABLES = [
  'workflowDefinitions', 'workflowStates', 'workflowTransitions', 'workflowInstances', 'workflowPendingApprovals',
  'workflowHistoryLogs', 'workflowDefinitionVersions', 'workflowTasks', 'workflowTaskReopenLog', 'workflowDelegations',
];
const DRIZZLE_WRITE = new RegExp(`\\.(?:insert|update|delete)\\(\\s*(?:${WORKFLOW_TABLES.join('|')})\\s*\\)`, 'g');
const SQL_WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+"?workflow_[a-z_]+"?/gi;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function workflowTableWriters(): string[] {
  const found: string[] = [];
  for (const file of productionFiles(SRC)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED_DIRS.some(dir => rel.startsWith(dir))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of [DRIZZLE_WRITE, SQL_WRITE]) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${rel}:${line} ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
  }
  return found;
}

describe('workflow tables are written only by the workflow engine (TD-692)', () => {
  it('no production file outside src/services/workflow writes a workflow table', () => {
    expect(workflowTableWriters()).toEqual([]);
  });

  it('the scan sees a direct write', () => {
    const sample = "await orm.update(workflowInstances).set({ status: 'COMPLETED' }); await tx.delete(workflowPendingApprovals);";
    expect(sample.match(DRIZZLE_WRITE)).toHaveLength(2);
    expect("UPDATE workflow_instances SET status = 'COMPLETED'".match(SQL_WRITE)).toHaveLength(1);
  });
});
