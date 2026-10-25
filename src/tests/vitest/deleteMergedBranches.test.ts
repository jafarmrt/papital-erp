import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { judgeBranch, run } from '../../../scripts/governance/deleteMergedBranches';

/** v11.0.1 (TD-1390): the hand-run workflow deletes only branches fully merged into the default branch. */
describe('delete merged branches (TD-1390)', () => {
  const open = new Set(['v10/woocommerce-auto-sync']);

  it('keeps the default, protected, open pull request and unmerged branches', () => {
    expect(judgeBranch({ name: 'master', protected: false }, 'master', open, 0).delete).toBe(false);
    expect(judgeBranch({ name: 'release/1', protected: true }, 'master', open, 0).delete).toBe(false);
    expect(judgeBranch({ name: 'v10/woocommerce-auto-sync', protected: false }, 'master', open, 0).delete).toBe(false);
    expect(judgeBranch({ name: 'v10/squashed', protected: false }, 'master', open, 3).reason).toBe('3 commit(s) not in master');
    expect(judgeBranch({ name: 'v10/unknown', protected: false }, 'master', open, null).delete).toBe(false);
    expect(judgeBranch({ name: 'claude/merged', protected: false }, 'master', open, 0).delete).toBe(true);
  });

  const fakeApi = (deleteStatus = 204) => {
    const calls: string[] = [];
    const ahead: Record<string, number> = { 'claude/merged': 0, 'claude/also-merged': 0, 'v10/unmerged': 2, 'v10/stack-base': 0 };
    const api = async (p: string, method = 'GET') => {
      calls.push(`${method} ${p}`);
      if (method === 'DELETE') return { status: deleteStatus, body: null };
      if (p === '/repos/o/r') return { status: 200, body: { default_branch: 'master' } };
      if (p.startsWith('/repos/o/r/branches')) {
        return { status: 200, body: ['master', 'claude/merged', 'claude/also-merged', 'v10/unmerged', 'v10/open-pr', 'v10/stack-base'].map(name => ({ name, protected: false })) };
      }
      if (p.startsWith('/repos/o/r/pulls')) {
        return { status: 200, body: [{ head: { ref: 'v10/open-pr', repo: { full_name: 'o/r' } }, base: { ref: 'master' } }, { head: { ref: 'fork-branch', repo: null }, base: { ref: 'v10/stack-base' } }] };
      }
      const m = p.match(/^\/repos\/o\/r\/compare\/master\.\.\.(.+)$/);
      if (m) return { status: 200, body: { ahead_by: ahead[decodeURIComponent(m[1])] } };
      return { status: 404, body: null };
    };
    return { api, calls };
  };

  it('keeps the base branch of an open pull request even when it is fully merged', async () => {
    const lines: string[] = [];
    await run(fakeApi().api, 'o/r', false, line => lines.push(line));
    expect(lines).toContain('keep    v10/stack-base (head or base of an open pull request)');
  });

  it('only lists without --delete', async () => {
    const { api, calls } = fakeApi();
    const result = await run(api, 'o/r', false, () => {});
    expect(result).toEqual({ deleted: 2, kept: 4, failed: 0 });
    expect(calls.filter(c => c.startsWith('DELETE'))).toEqual([]);
  });

  it('deletes exactly the fully merged branches with --delete and counts refusals', async () => {
    const { api, calls } = fakeApi();
    expect(await run(api, 'o/r', true, () => {})).toEqual({ deleted: 2, kept: 4, failed: 0 });
    expect(calls.filter(c => c.startsWith('DELETE'))).toEqual(['DELETE /repos/o/r/git/refs/heads/claude/merged', 'DELETE /repos/o/r/git/refs/heads/claude/also-merged']);
    expect(await run(fakeApi(422).api, 'o/r', true, () => {})).toEqual({ deleted: 0, kept: 4, failed: 2 });
  });

  it('runs by hand only, lists by default and may only write contents', () => {
    const yml = fs.readFileSync(path.join(process.cwd(), '.github/workflows/delete-merged-branches.yml'), 'utf8');
    expect(yml).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(yml).not.toMatch(/^ {2}(push|pull_request|schedule):/m);
    expect(yml).toMatch(/default: false/);
    expect(yml).toMatch(/permissions:\n {2}contents: write\n {2}pull-requests: read\n\n/);
  });
});
