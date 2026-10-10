// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import * as profileFields from '../../lib/users/profileFields';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// v10.0.90 (TD-1161): the profile picture hint said GIF and 5 MB while the picker left GIF out and the server takes 3 MB.
describe('profile_image_hint_matches_server_td_1161: the profile picture picker and hint follow the server', () => {
  it('the picker accepts exactly the formats the server stores', () => {
    const types = (profileFields as Record<string, unknown>).PROFILE_IMAGE_TYPES as readonly string[] | undefined;
    const server = /ALLOWED_MIME_TYPES = new Set\(\[([^\]]*)\]\)/.exec(read('src/lib/storage.ts'))?.[1] ?? '';
    const serverTypes = new Set(server.split(',').map(s => s.trim().replace(/'/g, '')).map(t => (t === 'jpg' ? 'jpeg' : t)));
    expect([...(types ?? [])].map(t => t.replace('image/', '')).sort()).toEqual([...serverTypes].sort());
  });

  it('the profile window takes its accept list, check and hint from the shared constants and names no size limit', () => {
    const modal = read('src/components/UserProfileModal.tsx');
    expect(modal).toContain('accept={PROFILE_IMAGE_ACCEPT}');
    expect(modal).toContain('{PROFILE_IMAGE_HINT}');
    expect(modal).toContain('isProfileImageType(file.type)');
    expect(modal).not.toMatch(/مگابایت/);
    expect(String((profileFields as Record<string, unknown>).PROFILE_IMAGE_HINT ?? '')).not.toMatch(/مگابایت/);
  });
});
