// @vitest-environment node
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const CI_YML = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** کمترین نسخه اصلی هر action که روی Node 24 اجرا می‌شود؛ فقط بالا می‌رود (TD-471). */
const MIN_ACTION_MAJOR: Record<string, number> = {
  'actions/checkout': 7,
  'actions/setup-node': 7,
  'actions/upload-artifact': 7,
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('ci_actions_node24_runner_pinned_td_471: CI workflow maintenance', () => {
  it('every action runs on its Node 24 major', () => {
    const uses = [...CI_YML.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@v(\d+)/g)].map(m => ({ name: m[1], major: Number(m[2]) }));
    expect(uses.length).toBeGreaterThan(0);
    const stale = uses.filter(u => u.major < (MIN_ACTION_MAJOR[u.name] ?? 0));
    expect(stale).toEqual([]);
    expect(uses.every(u => u.name in MIN_ACTION_MAJOR)).toBe(true);
  });

  it('every job runs on a pinned Ubuntu image, never a moving -latest label', () => {
    const runners = [...CI_YML.matchAll(/runs-on:\s*(\S+)/g)].map(m => m[1]);
    expect(runners.length).toBeGreaterThan(0);
    expect(runners.filter(r => !/^ubuntu-\d{2}\.\d{2}$/.test(r))).toEqual([]);
  });
});

