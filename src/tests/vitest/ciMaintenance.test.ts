// @vitest-environment node
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
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

describe('node_modules_never_tracked_td_472: node_modules is never tracked (B01-03)', () => {
  it('the repository index has no node_modules entry', () => {
    expect(git(ROOT, 'ls-files', '-s', '--', 'node_modules').trim()).toBe('');
  });

  it('.gitignore ignores a node_modules symlink, not only a directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td472-ignore-'));
    try {
      git(dir, 'init', '-q');
      fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'));
      fs.symlinkSync('/nonexistent', path.join(dir, 'node_modules'));
      expect(git(dir, 'check-ignore', 'node_modules').trim()).toBe('node_modules');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a server that pulled the tracked symlink can pull its removal after the untrack script', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td472-pull-'));
    try {
      const origin = path.join(dir, 'origin');
      fs.mkdirSync(origin);
      git(origin, 'init', '-q', '-b', 'master');
      fs.writeFileSync(path.join(origin, 'app.txt'), 'v1\n');
      fs.writeFileSync(path.join(origin, '.gitignore'), 'node_modules/\n'); // the .gitignore of v9.0.25 to v9.0.45
      fs.symlinkSync('/nonexistent/node_modules', path.join(origin, 'node_modules'));
      git(origin, 'add', '-A');
      git(origin, 'commit', '-qm', 'tracked symlink');

      const deploy = path.join(dir, 'deploy');
      git(dir, 'clone', '-q', origin, deploy);
      // npm ci replaces the broken link with a real directory
      fs.rmSync(path.join(deploy, 'node_modules'));
      fs.mkdirSync(path.join(deploy, 'node_modules'));
      fs.writeFileSync(path.join(deploy, 'node_modules', 'MARKER'), 'deps\n');

      git(origin, 'rm', '-q', '--cached', 'node_modules');
      fs.rmSync(path.join(origin, 'node_modules'));
      fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(origin, '.gitignore'));
      git(origin, 'add', '-A');
      git(origin, 'commit', '-qm', 'remove symlink');

      expect(() => git(deploy, 'pull', '-q', '--ff-only')).toThrow();

      execFileSync('bash', [path.join(ROOT, 'scripts/untrack-node-modules-link.sh'), deploy], { stdio: 'pipe' });
      git(deploy, 'pull', '-q', '--ff-only');
      expect(fs.readFileSync(path.join(deploy, 'node_modules', 'MARKER'), 'utf8')).toBe('deps\n');
      expect(git(deploy, 'status', '--porcelain').trim()).toBe('');
      // a second run is a no-op
      execFileSync('bash', [path.join(ROOT, 'scripts/untrack-node-modules-link.sh'), deploy], { stdio: 'pipe' });
      expect(git(deploy, 'status', '--porcelain').trim()).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
