import path from 'path';
import bcrypt from 'bcryptjs';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { createScratchCluster, querySql, REPO_ROOT, runCommand } from '../recovery/scratchDatabase.js';

/**
 * v9.0.398 (TD-617, B01-37, decision t4 «الف»): the boot never turns a stored non-bcrypt value into a working password;
 * the one-off `npm run users:lock-plain-passwords` previews by default and with `--apply` locks each such value (deleted
 * users too): lock marker instead of the value, reset required, token version advanced, one audit row per user without
 * the value. Red on v9.0.397, whose boot hashed every non-bcrypt string into a password and had no such script.
 */

const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const LEAKED = 'Leaked-Pass-617';
const DELETED_PLAIN = 'Deleted-Pass-617';

type UserRow = { username: string; password: string; must_reset_password: number; token_version: number };

export async function runPlainPasswordLockTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  if (!shouldRun('sec_plain_password_lock_td_617', 'security', 'td617', 'password', 'boot', 'package1')) return results;

  await runCase(results, {
    id: 'sec_plain_password_lock_td_617',
    name: 'v9.0.398: the boot leaves non-bcrypt passwords alone and the one-off script locks them with a reset and an audit row (TD-617)',
    details: 'an empty database booted twice with users holding a plain password, an old lock marker, an argon2 hash, an empty value and a deleted user\'s plain password: the second boot changes none of them; the script preview changes nothing; --apply locks exactly those five (marker, reset required, token version + 1, one audit row each without the value) and leaves the bcrypt user alone; a second --apply locks nothing',
  }, async (_h, wrong) => {
    const cluster = await createScratchCluster('pwd617');
    try {
      const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
        querySql(cluster.appUrl, sql, params) as Promise<T[]>;
      const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: cluster.appUrl, ERP_TEST_SCHEMA_ISOLATION: '0' };
      const boot = async () => {
        const run = await runCommand(TSX, ['src/tests/recovery/bootDatabaseCli.ts'], { env });
        if (run.code !== 0) throw new Error(`boot data steps failed (${run.code}): ${run.output.slice(-1500)}`);
      };
      const script = (...args: string[]) => runCommand(TSX, ['scripts/lock-plain-passwords.ts', ...args], { env });
      const usersNow = async () => new Map((await q<UserRow>(
        `SELECT username, password, must_reset_password, token_version FROM users WHERE username LIKE 'td617_%'`)).map(r => [r.username, r]));
      const auditCount = async () => Number((await q<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM activity_logs WHERE (details->>'lockedNonBcryptPassword')::boolean IS TRUE`))[0]?.n ?? 0);

      await boot();
      const stored: Record<string, string> = {
        td617_plain: LEAKED,
        td617_marker: '!locked',
        td617_argon: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo',
        td617_empty: '',
        td617_deleted: DELETED_PLAIN,
        td617_bcrypt: bcrypt.hashSync('Good-Pass-617', 10),
      };
      for (const [username, password] of Object.entries(stored)) {
        await q(`INSERT INTO users (username, password, full_name, role, token_version, is_deleted) VALUES ($1, $2, $1, 'admin', 3, $3)`,
          [username, password, username === 'td617_deleted' ? 1 : 0]);
      }

      await boot();
      const afterBoot = await usersNow();
      for (const [username, password] of Object.entries(stored)) {
        if (afterBoot.get(username)?.password !== password) wrong.push(`the boot rewrote the stored password of ${username}`);
      }

      const preview = await script();
      if (preview.code !== 0 || !preview.output.includes('users with a non-bcrypt password: 5')) {
        wrong.push(`the preview answered ${preview.code}: ${preview.output.slice(-600)}`);
      }
      if (preview.output.includes(LEAKED) || preview.output.includes(DELETED_PLAIN)) wrong.push('the preview printed a stored password');
      const afterPreview = await usersNow();
      for (const [username, password] of Object.entries(stored)) {
        if (afterPreview.get(username)?.password !== password) wrong.push(`the preview changed ${username}`);
      }
      if (await auditCount() !== 0) wrong.push('the preview wrote an audit row');

      const applied = await script('--apply');
      if (applied.code !== 0 || !applied.output.includes('locked now: 5')) wrong.push(`--apply answered ${applied.code}: ${applied.output.slice(-600)}`);
      const afterApply = await usersNow();
      const markers = new Set<string>();
      for (const username of Object.keys(stored).filter(u => u !== 'td617_bcrypt')) {
        const row = afterApply.get(username);
        markers.add(String(row?.password));
        if (!row || row.password === stored[username] || row.password.startsWith('$2')) wrong.push(`${username} was not locked (${row?.password?.slice(0, 12)})`);
        if (Number(row?.must_reset_password) !== 1) wrong.push(`${username} does not require a password reset`);
        if (Number(row?.token_version) !== 4) wrong.push(`${username} kept its sessions (token version ${row?.token_version})`);
      }
      if (markers.size !== 1) wrong.push(`the locked users hold different values: ${[...markers].join(', ')}`);
      const good = afterApply.get('td617_bcrypt');
      if (good?.password !== stored.td617_bcrypt || Number(good?.token_version) !== 3 || Number(good?.must_reset_password) !== 0) {
        wrong.push('the bcrypt user was changed');
      }
      if (await auditCount() !== 5) wrong.push(`expected 5 audit rows, found ${await auditCount()}`);
      const auditText = JSON.stringify(await q(`SELECT description, details FROM activity_logs WHERE (details->>'lockedNonBcryptPassword')::boolean IS TRUE`));
      if (auditText.includes(LEAKED) || auditText.includes(DELETED_PLAIN) || auditText.includes('argon2id')) wrong.push('an audit row holds the stored value');

      const again = await script('--apply');
      if (again.code !== 0 || !again.output.includes('locked now: 0')) wrong.push(`the second --apply answered ${again.code}: ${again.output.slice(-400)}`);
      if (await auditCount() !== 5) wrong.push('the second --apply wrote audit rows');
    } finally {
      await cluster.teardown();
    }
  });
  return results;
}
