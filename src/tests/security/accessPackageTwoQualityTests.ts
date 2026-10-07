import fs from 'fs';
import path from 'path';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { AVATAR_INVALID_MESSAGE, FULL_NAME_TOO_LONG_MESSAGE } from '../../lib/users/profileFields.js';

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

  return results;
}
