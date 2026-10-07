import fs from 'fs';
import path from 'path';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { AVATAR_INVALID_MESSAGE, FULL_NAME_TOO_LONG_MESSAGE } from '../../lib/users/profileFields.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * Package 2 (permission model), quality group: user profile fields and the user pick list through the real Express
 * routes. Every case is red on the previous version.
 */

const messageOf = (res: { body?: { message?: unknown; error?: unknown } }): string => String(res.body?.message ?? res.body?.error ?? '');

// 1x1 transparent PNG
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function runAccessPackageTwoQualityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_profile_fields_bounded_td_533', 'security', 'td533', 'profile', 'package2')) {
    await runCase(results, {
      id: 'sec_profile_fields_bounded_td_533',
      name: 'v9.0.165: the profile takes only an uploaded avatar and a name of at most 100 characters (TD-533)',
      details: 'B02-18: PUT /users/profile stored any avatar string (an outside tracker URL, a million characters) and any name length, and list-simple sent them to every signed-in user; now an outside URL or other text is refused with 400, a new image goes to /uploads, a /uploads path of this system is kept, and a name over 100 characters is refused by the profile, POST /users and PUT /users/:id',
    }, async (h, wrong) => {
      const member = await h.sessionWith(['documents.view']);
      const avatarOf = async () => String((await h.q('SELECT avatar_url FROM users WHERE id = $1', [member.userId]))[0]?.avatar_url ?? '');
      const refused = (label: string, res: { status: number; body?: { message?: unknown; error?: unknown } }, message: string) => {
        if (res.status !== 400 || !messageOf(res).includes(message)) wrong.push(`${label} returned ${res.status} «${messageOf(res)}», not 400 «${message}»`);
      };
      let uploaded = '';
      try {
        for (const avatar of ['https://tracker.example/pixel.png?who=td533', 'x'.repeat(2000), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', '/uploads/../../etc/passwd']) {
          refused(`avatar «${avatar.slice(0, 40)}»`, await h.put('/api/users/profile', { avatar }, member), AVATAR_INVALID_MESSAGE);
        }
        if (await avatarOf() !== '') wrong.push(`a refused avatar was stored: «${(await avatarOf()).slice(0, 60)}»`);

        const image = await h.put('/api/users/profile', { avatar: TINY_PNG }, member);
        uploaded = await avatarOf();
        if (image.status !== 200 || !/^\/uploads\/[\w-]+\.png$/.test(uploaded)) wrong.push(`a new image returned ${image.status} and stored «${uploaded}», not an /uploads path`);
        const kept = await h.put('/api/users/profile', { avatar: uploaded, full_name: 'ن'.repeat(100) }, member);
        if (kept.status !== 200) wrong.push(`keeping the stored avatar with a 100-character name returned ${kept.status}`);

        refused('PUT /users/profile with a 101-character name', await h.put('/api/users/profile', { full_name: 'ن'.repeat(101) }, member), FULL_NAME_TOO_LONG_MESSAGE);
        refused('POST /users with a 101-character name', await h.post('/api/users', { username: `td533_${h.tag}`, password: 'Passw0rd!x', full_name: 'ن'.repeat(101), role: member.role }), FULL_NAME_TOO_LONG_MESSAGE);
        refused('PUT /users/:id with a 101-character name', await h.put(`/api/users/${member.userId}`, { full_name: 'ن'.repeat(101), role: member.role }), FULL_NAME_TOO_LONG_MESSAGE);
      } finally {
        await h.q('DELETE FROM users WHERE username = $1', [`td533_${h.tag}`]).catch(() => undefined);
        if (/^\/uploads\/[\w-]+\.png$/.test(uploaded)) fs.rmSync(path.join(process.cwd(), 'public', uploaded), { force: true });
      }
    });
  }

  if (shouldRun('sec_list_simple_role_name_td_534', 'security', 'td534', 'list-simple', 'package2')) {
    await runCase(results, {
      id: 'sec_list_simple_role_name_td_534',
      name: 'v9.0.166: the simple user list gives the role\'s Persian name, never its code (TD-534)',
      details: 'B02-19: GET /users/list-simple, open to every signed-in user, sent each user\'s role code (for example cfo_accountant) while GET /users was 403 for the same reader; now no row has a role code, each row carries the stored name of its role (the system admin «مدیر سیستم» when its role row has no name) and the user name stays for mentions',
    }, async (h, wrong) => {
      const reader = await h.sessionWith(['daily_logs.create']);
      const res = await h.get('/api/users/list-simple', reader);
      if (res.status !== 200 || !Array.isArray(res.body)) throw new Error(`GET /users/list-simple returned ${res.status}`);
      const rows = res.body as Array<Record<string, unknown>>;
      const roleCodes = new Set((await h.q('SELECT DISTINCT role FROM users WHERE is_deleted = 0')).map(r => String(r.role)));
      const withCode = rows.filter(r => 'role' in r || Object.values(r).some(v => typeof v === 'string' && roleCodes.has(v) && v !== r.username));
      if (withCode.length > 0) wrong.push(`${withCode.length} rows still carry a role code, e.g. ${JSON.stringify(withCode[0])}`);

      const own = rows.find(r => Number(r.id) === reader.userId);
      const [role] = await h.q('SELECT name FROM roles WHERE code = $1', [reader.role]);
      if (!own) wrong.push('the reader is missing from the list');
      else {
        if (own.role_name !== role?.name) wrong.push(`the reader's row says role «${String(own.role_name)}», not its role's name «${String(role?.name)}»`);
        if (typeof own.username !== 'string' || own.username === '') wrong.push('the user name needed for mentions is missing');
      }
      const [admin] = await h.q('SELECT id FROM users WHERE role = $1 AND is_deleted = 0 ORDER BY id LIMIT 1', [SYSTEM_ADMIN_ROLE]);
      const adminRow = rows.find(r => Number(r.id) === Number(admin?.id));
      if (admin && (!adminRow || typeof adminRow.role_name !== 'string' || adminRow.role_name === '')) {
        wrong.push(`the system admin's row has no role name: ${JSON.stringify(adminRow)}`);
      }
    });
  }

  return results;
}
