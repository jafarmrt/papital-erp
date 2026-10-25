/**
 * v11.0.1 (TD-1390, product-owner decision of 3 Aban 1405): deletes the remote branches that are fully merged into the
 * default branch, run by hand from the «Delete merged branches» workflow (.github/workflows/delete-merged-branches.yml).
 * A branch is kept when it is the default branch, protected, the head of an open pull request, or has any commit the
 * default branch lacks (squash-merged or unmerged work). Without `--delete` it only lists what it would delete.
 * Terminal output is English (AGENTS.md, owner rule t9). Node built-ins only, run with `node` (type stripping).
 *
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/governance/deleteMergedBranches.ts [--delete]
 */

export interface BranchInfo {
  name: string;
  protected: boolean;
}

export interface BranchVerdict {
  name: string;
  delete: boolean;
  reason: string;
}

/** Pure decision: aheadBy is the number of commits the branch has that the default branch lacks (null = unknown) */
export function judgeBranch(branch: BranchInfo, defaultBranch: string, openPrHeads: Set<string>, aheadBy: number | null): BranchVerdict {
  const keep = (reason: string): BranchVerdict => ({ name: branch.name, delete: false, reason });
  if (branch.name === defaultBranch) return keep('default branch');
  if (branch.protected) return keep('protected');
  if (openPrHeads.has(branch.name)) return keep('head of an open pull request');
  if (aheadBy === null) return keep('comparison failed');
  if (aheadBy > 0) return keep(`${aheadBy} commit(s) not in ${defaultBranch}`);
  return { name: branch.name, delete: true, reason: `fully merged into ${defaultBranch}` };
}

type Api = (path: string, method?: string) => Promise<{ status: number; body: unknown }>;

async function pages<T>(api: Api, path: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const { status, body } = await api(`${path}${sep}per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(body)) throw new Error(`GET ${path} answered ${status}`);
    all.push(...(body as T[]));
    if (body.length < 100) return all;
  }
}

export async function run(api: Api, repo: string, doDelete: boolean, log: (line: string) => void): Promise<{ deleted: number; kept: number; failed: number }> {
  const meta = await api(`/repos/${repo}`);
  const defaultBranch = String((meta.body as { default_branch?: unknown })?.default_branch ?? '');
  if (meta.status !== 200 || !defaultBranch) throw new Error(`GET /repos/${repo} answered ${meta.status}`);
  const branches = await pages<BranchInfo>(api, `/repos/${repo}/branches`);
  const prs = await pages<{ head: { ref: string; repo: { full_name: string } | null } }>(api, `/repos/${repo}/pulls?state=open`);
  const openPrHeads = new Set(prs.filter(p => p.head.repo?.full_name === repo).map(p => p.head.ref));

  let deleted = 0;
  let kept = 0;
  let failed = 0;
  for (const branch of branches) {
    let aheadBy: number | null = null;
    if (branch.name !== defaultBranch && !branch.protected && !openPrHeads.has(branch.name)) {
      const cmp = await api(`/repos/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch.name)}`);
      const ahead = (cmp.body as { ahead_by?: unknown })?.ahead_by;
      if (cmp.status === 200 && typeof ahead === 'number') aheadBy = ahead;
    }
    const verdict = judgeBranch(branch, defaultBranch, openPrHeads, aheadBy);
    if (!verdict.delete) {
      kept++;
      log(`keep    ${verdict.name} (${verdict.reason})`);
      continue;
    }
    if (!doDelete) {
      deleted++;
      log(`would delete ${verdict.name}`);
      continue;
    }
    const res = await api(`/repos/${repo}/git/refs/heads/${verdict.name.split('/').map(encodeURIComponent).join('/')}`, 'DELETE');
    if (res.status === 204) {
      deleted++;
      log(`deleted ${verdict.name}`);
    } else {
      failed++;
      log(`FAILED  ${verdict.name} (DELETE answered ${res.status})`);
    }
  }
  log(`${doDelete ? 'deleted' : 'would delete'}: ${deleted}, kept: ${kept}, failed: ${failed}`);
  return { deleted, kept, failed };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  const api: Api = async (path, method = 'GET') => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const { failed } = await run(api, repo, process.argv.includes('--delete'), line => console.log(line));
  if (failed > 0) process.exit(1);
}

if (process.argv[1] && /deleteMergedBranches\.ts$/.test(process.argv[1])) {
  main().catch(err => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
