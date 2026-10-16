/**
 * Closing sweep, OBS-R1-26: drizzle-kit commands that compare the schema with the stale `drizzle/meta` snapshot or the
 * database are refused by `drizzle.config.ts`; only `studio` and `check` run. Red on v10.1.55.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drizzleKitCommandRefusal } from '../../../scripts/drizzleKitGuard';

const kit = (...args: string[]) => ['node', 'drizzle-kit', ...args];

describe('OBS-R1-26 drizzle-kit guard', () => {
  it('obs_r1_26_refuses_schema_writing_commands: generate, push, migrate, drop, up and pull are refused', () => {
    for (const command of ['generate', 'push', 'migrate', 'drop', 'up', 'pull', 'introspect']) {
      expect(drizzleKitCommandRefusal(kit(command, '--config', 'drizzle.config.ts'))).toContain(`drizzle-kit ${command} is disabled`);
    }
    expect(drizzleKitCommandRefusal(kit('studio'))).toBeNull();
    expect(drizzleKitCommandRefusal(kit('check'))).toBeNull();
    expect(drizzleKitCommandRefusal(['node', 'server.ts'])).toBeNull();
  });

  it('obs_r1_26_config_applies_guard: drizzle.config.ts refuses before building its config, and no npm script runs a refused command', () => {
    const config = readFileSync('drizzle.config.ts', 'utf8');
    expect(config).toMatch(/drizzleKitCommandRefusal\(process\.argv\)/);
    expect(config.indexOf('drizzleKitCommandRefusal(process.argv)')).toBeLessThan(config.indexOf('defineConfig({'));
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    const kitScripts = Object.values(scripts).filter(cmd => /drizzle-kit\s/.test(cmd));
    for (const cmd of kitScripts) expect(drizzleKitCommandRefusal(cmd.split(/\s+/))).toBeNull();
  });
});
