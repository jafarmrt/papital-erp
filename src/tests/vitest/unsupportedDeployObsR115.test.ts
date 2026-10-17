// @vitest-environment node
/**
 * v10.1.65 (OBS-R1-15 / OBS-R1-19, decision ت۴۰ item 20): the Kubernetes manifest is an unsupported example and says
 * so at its top, the manual install reads the example environment file that exists, and CI has no staging jobs: the
 * deploy only printed a line and the smoke test skipped itself without a secret, so both looked like checks and were none.
 */
import fs from 'fs';
import { describe, expect, it } from 'vitest';

const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const manifest = fs.readFileSync('deploy/k8s/erp-deployment.yaml', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');

describe('unsupported_k8s_and_no_staging_obs_r1_15', () => {
  it('CI has no staging job and no staging branch condition', () => {
    expect(ci).not.toMatch(/^ {2}(deploy-staging|smoke-test-staging):/m);
    expect(ci).not.toContain('refs/heads/staging');
    expect(ci).not.toContain('staging.erp.example.com');
  });

  it('no_staging_word_in_ci: neither the triggers nor the header comment name a staging branch or deploy (#309 review)', () => {
    expect(ci.toLowerCase()).not.toContain('staging');
  });

  it('the Kubernetes manifest says at its top that it is an unsupported example', () => {
    expect(manifest.split('\n').slice(0, 5).join('\n')).toContain('UNSUPPORTED EXAMPLE');
  });

  it('no install text points to the missing .env.production.example', () => {
    expect(fs.existsSync('.env.production.example')).toBe(false);
    expect(readme).not.toContain('.env.production.example');
    expect(manifest).not.toContain('.env.production.example');
  });
});
