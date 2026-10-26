// @vitest-environment node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MediaLibraryHealthCard } from '../../components/system/MediaLibraryHealthCard';
import {
  MEDIA_LIBRARY_HEALTH_MESSAGES, MEDIA_OFFSITE_MESSAGES, MEDIA_OFFSITE_STALE_HOURS, isMediaOffsiteWarning, mediaOffsiteFailedMessage,
  mediaOffsiteVerdict, parseMediaOffsiteReport, type MediaLibraryHealth,
} from '../../lib/system/mediaLibraryHealth';

// v10.2.31 (decision T43-a, 10.2 package 13 item 7): the media library (photos and videos of products) was in no
// off-server copy: the daily backup leaves it out for its size. scripts/backup-media-offsite.sh now sends the new
// originals every night to the encrypted rclone remote, and the health page shows the last complete copy. The real
// script runs here against a fake rclone.

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/backup-media-offsite.sh');
let dir = '';
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = ''; });

const FAKE_RCLONE = `#!/bin/bash
echo "$*" >> "$FAKE_RCLONE_LOG"
local_path() { local p="\${1#*:}"; echo "$FAKE_REMOTE_DIR/\${p%/}"; }
case "$1" in
  listremotes) echo "papital-crypt: \${FAKE_REMOTE_TYPE:-crypt}"; echo "gdrive: drive" ;;
  copy)
    [ "\${FAKE_RCLONE_FAIL:-}" != "copy" ] || exit 1
    dst="$(local_path "$3")"; mkdir -p "$dst"; cp -rn "$2"/. "$dst"/ ;;
  check)
    [ "\${FAKE_RCLONE_FAIL:-}" != "check" ] || exit 1
    dst="$(local_path "$3")"
    (cd "$2" && find . -type f) | while read -r f; do
      [ -f "$dst/$f" ] && [ "$(stat -c %s "$2/$f")" = "$(stat -c %s "$dst/$f")" ] || exit 1
    done ;;
  *) exit 1 ;;
esac
`;

interface Setup { appDir: string; media: string; remote: string; log: string; report: string; env: NodeJS.ProcessEnv }

function setup(envLines: string): Setup {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-offsite-'));
  const appDir = path.join(dir, 'app');
  const media = path.join(appDir, 'media-library');
  const remote = path.join(dir, 'remote');
  const bin = path.join(dir, 'bin');
  for (const d of [appDir, remote, bin, path.join(media, 'originals', 'ab'), path.join(media, 'light', 'ab'), path.join(media, 'tmp')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(media, 'originals', 'ab', 'ab01.jpg'), 'photo-one');
  fs.writeFileSync(path.join(media, 'originals', 'ab', 'ab02.mp4'), 'video-two-longer');
  fs.writeFileSync(path.join(media, 'light', 'ab', 'ab01.webp'), 'light');
  fs.writeFileSync(path.join(media, 'tmp', 'x.part'), 'partial');
  fs.writeFileSync(path.join(bin, 'rclone'), FAKE_RCLONE, { mode: 0o755 });
  fs.writeFileSync(path.join(appDir, '.env'), `NODE_ENV=production\n${envLines}`);
  const log = path.join(dir, 'rclone.log');
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, APP_DIR: appDir, FAKE_REMOTE_DIR: remote, FAKE_RCLONE_LOG: log };
  return { appDir, media, remote, log, report: path.join(appDir, 'logs', 'media-offsite.json'), env };
}

const run = (s: Setup, extra: Record<string, string> = {}) => spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...s.env, ...extra } });
const report = (s: Setup) => JSON.parse(fs.readFileSync(s.report, 'utf8')) as Record<string, unknown>;
const calls = (s: Setup) => (fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : '');

describe('media_offsite_t43: the nightly encrypted copy of the media library', () => {
  it('copies only the originals, only new ones, checks them and records the time', () => {
    const s = setup('MEDIA_RCLONE_REMOTE=papital-crypt:\n');
    const first = run(s);
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    const copied = path.join(s.remote, 'media-library', 'originals', 'ab');
    expect(fs.readdirSync(copied).sort()).toEqual(['ab01.jpg', 'ab02.mp4']);
    expect(fs.existsSync(path.join(s.remote, 'media-library', 'light'))).toBe(false);
    expect(fs.existsSync(path.join(s.remote, 'media-library', 'tmp'))).toBe(false);
    expect(calls(s)).toMatch(/^copy \S+\/originals papital-crypt:media-library\/originals --ignore-existing/m);
    expect(calls(s)).toMatch(/^check \S+\/originals papital-crypt:media-library\/originals --one-way --size-only/m);
    const r = report(s);
    expect(r).toMatchObject({ version: 1, state: 'ok', files: 2, bytes: 25, remote: 'papital-crypt', error: '' });
    expect(r.lastOkAt).toBe(r.at);
    // a remote with a folder keeps it; the run never touches the rclone configuration
    expect(run(s, { MEDIA_RCLONE_REMOTE: 'papital-crypt:photos' }).status).toBe(0);
    expect(fs.readdirSync(path.join(s.remote, 'photos', 'originals', 'ab'))).toHaveLength(2);
    expect(calls(s)).not.toMatch(/^config/m);
  });

  it('is off without MEDIA_RCLONE_REMOTE: exit 0, no rclone call, the report says off', () => {
    const s = setup('');
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('is off');
    expect(calls(s)).toBe('');
    expect(report(s)).toMatchObject({ state: 'off', lastOkAt: null, remote: '' });
  });

  it('refuses a remote that is not crypt and keeps the time of the last complete copy', () => {
    const s = setup('MEDIA_RCLONE_REMOTE=papital-crypt:\n');
    expect(run(s).status).toBe(0);
    const okAt = report(s).lastOkAt;
    fs.rmSync(path.join(s.remote, 'media-library'), { recursive: true });
    const r = run(s, { FAKE_REMOTE_TYPE: 'drive' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('not crypt');
    expect(fs.existsSync(path.join(s.remote, 'media-library'))).toBe(false);
    expect(report(s)).toMatchObject({ state: 'failed', error: 'not-crypt', lastOkAt: okAt });
  });

  it('reports an unknown remote, a failed copy and a failed check', () => {
    const s = setup('MEDIA_RCLONE_REMOTE=other:\n');
    expect(run(s).status).toBe(1);
    expect(report(s)).toMatchObject({ state: 'failed', error: 'no-remote', lastOkAt: null });
    for (const [fail, code] of [['copy', 'copy-failed'], ['check', 'check-failed']]) {
      const r = run(s, { MEDIA_RCLONE_REMOTE: 'papital-crypt:', FAKE_RCLONE_FAIL: fail });
      expect(r.status).toBe(1);
      expect(report(s)).toMatchObject({ state: 'failed', error: code });
    }
  });

  it('skips a run while another one holds the lock', async () => {
    const s = setup('MEDIA_RCLONE_REMOTE=papital-crypt:\n');
    fs.mkdirSync(path.dirname(s.report), { recursive: true });
    const lock = path.join(path.dirname(s.report), '.media-offsite.lock');
    const holder = spawn('flock', [lock, 'sleep', '5']);
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const r = run(s);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('still running');
      expect(calls(s)).toBe('');
    } finally {
      holder.kill();
    }
  });

  it('the documented .env step sets the remote once, whatever the last line or an empty key (#349 review)', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/OFFSITE_BACKUP.md'), 'utf8');
    const step = doc.slice(doc.indexOf('## گام ۴')).match(/```bash\n([\s\S]*?)```/)![1];
    expect(step).toContain("sed -i -e '$a\\' .env");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-offsite-env-'));
    const script = step.replace(/^\s+/gm, '').replace(/\bsudo /g, '').replace('cd /opt/papital-erp', `cd '${dir}'`);
    const run = () => expect(spawnSync('bash', ['-euc', script], { encoding: 'utf8' }).status).toBe(0);
    for (const [before, after] of [
      ['A=1\nB=2', 'A=1\nB=2\nMEDIA_RCLONE_REMOTE=papital-crypt:\n'],
      ['A=1\nMEDIA_RCLONE_REMOTE=\nB=2\n', 'A=1\nMEDIA_RCLONE_REMOTE=papital-crypt:\nB=2\n'],
      ['A=1\nMEDIA_RCLONE_REMOTE=papital-crypt:\n', 'A=1\nMEDIA_RCLONE_REMOTE=papital-crypt:\n'],
    ]) {
      fs.writeFileSync(path.join(dir, '.env'), before);
      run();
      expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toBe(after);
      run();
      expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toBe(after);
    }
  });

  it('install-ops-cron.sh schedules it nightly at 01:00 as the backup user and keeps a time already written', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cron-'));
    const cronFile = path.join(dir, 'papital-erp');
    const user = os.userInfo().username;
    const cron = (env: Record<string, string>) => spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), user], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: cronFile, APP_DIR: ROOT, ...env },
    });
    expect(cron({}).status).toBe(0);
    expect(fs.readFileSync(cronFile, 'utf8')).toContain(`0 1 * * * ${user} bash ${ROOT}/scripts/backup-media-offsite.sh >> ${ROOT}/logs/media-offsite.log 2>&1`);
    expect(cron({ MEDIA_OFFSITE_HOUR: '23', MEDIA_OFFSITE_MINUTE: '15' }).status).toBe(0);
    const again = cron({});
    expect(again.stderr).toContain('MEDIA_OFFSITE_HOUR not given, the existing 23 is kept');
    expect(fs.readFileSync(cronFile, 'utf8')).toContain(`15 23 * * * ${user} bash ${ROOT}/scripts/backup-media-offsite.sh`);
    expect(cron({ MEDIA_OFFSITE_HOUR: '24' }).status).toBe(1);
  });
});

describe('media_offsite_t43_health: the media library card shows the copy', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const at = (hoursAgo: number) => Math.floor(now.getTime() / 1000) - hoursAgo * 3600;
  const text = (r: object) => JSON.stringify({ version: 1, files: 2, bytes: 25, remote: 'papital-crypt', error: '', ...r });

  it('reads the report: off, complete, stale, failed; a bad report is not one', () => {
    expect(mediaOffsiteVerdict(null, now)).toMatchObject({ state: 'off', message: MEDIA_OFFSITE_MESSAGES.off });
    const ok = mediaOffsiteVerdict(parseMediaOffsiteReport(text({ state: 'ok', at: at(3), lastOkAt: at(3) })), now);
    expect(ok).toMatchObject({ state: 'ok', fileCount: 2, lastOkAt: new Date(at(3) * 1000).toISOString() });
    const stale = mediaOffsiteVerdict(parseMediaOffsiteReport(text({ state: 'ok', at: at(1), lastOkAt: at(MEDIA_OFFSITE_STALE_HOURS + 1) })), now);
    expect(stale.state).toBe('stale');
    const failed = mediaOffsiteVerdict(parseMediaOffsiteReport(text({ state: 'failed', at: at(1), lastOkAt: at(30), error: 'not-crypt' })), now);
    expect(failed).toMatchObject({ state: 'failed', message: mediaOffsiteFailedMessage('not-crypt') });
    expect(failed.message).toContain('رمزگذار نیست');
    expect(isMediaOffsiteWarning(failed) && isMediaOffsiteWarning(stale) && !isMediaOffsiteWarning(ok)).toBe(true);
    for (const bad of ['', '{}', text({ state: 'done', at: 1, lastOkAt: null }), text({ state: 'ok', at: -1, lastOkAt: null })]) {
      expect(parseMediaOffsiteReport(bad)).toBeNull();
    }
  });

  it('the card shows the last complete copy in Persian and no Latin text', () => {
    const base: MediaLibraryHealth = {
      status: 'ok', path: '/opt/papital-erp/media-library', fileCount: 2, imageCount: 1, videoCount: 1, originalBytes: 25,
      lightBytes: 5, thumbBytes: 1, lightFailedCount: 0, lightMissingCount: 0, diskFreeBytes: 50 * 1024 ** 3,
      diskTotalBytes: 100 * 1024 ** 3, messages: [MEDIA_LIBRARY_HEALTH_MESSAGES.ok],
    };
    const off = renderToStaticMarkup(<MediaLibraryHealthCard media={{ ...base, offsite: mediaOffsiteVerdict(null, now) }} />);
    expect(off).toContain('راه‌اندازی نشده');
    const failed = mediaOffsiteVerdict(parseMediaOffsiteReport(text({ state: 'failed', at: at(1), lastOkAt: at(30), error: 'copy-failed' })), now);
    const html = renderToStaticMarkup(<MediaLibraryHealthCard media={{ ...base, status: 'warning', messages: [failed.message], offsite: failed }} />);
    expect(html).toContain('آخرین رونوشت کامل:');
    expect(html).toContain('(ناموفق)');
    expect(html).toContain('ارسال پرونده‌ها کامل نشد');
    const visible = html.replace(/<details[\s\S]*?<\/details>/g, '').replace(/<[^>]+>/g, '');
    expect(visible).not.toMatch(/[A-Za-z0-9]/);
  });
});
