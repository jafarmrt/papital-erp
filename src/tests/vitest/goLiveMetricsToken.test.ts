/**
 * Closing sweep (#297 review): go-live-verify reads /metrics with METRICS_TOKEN given to curl on stdin (--config -),
 * so the token never appears on a command line that ps shows to other users. Red on v10.1.65 (curl -H "X-Metrics-Token: …").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(process.cwd(), 'scripts', 'go-live-verify.sh'), 'utf8');

describe('go-live-verify keeps the metrics token off the command line', () => {
  it('go_live_metrics_token_on_stdin: no curl argument carries the token; curl reads its header from stdin', () => {
    const curlLines = script.split('\n').filter(line => /\bcurl\b/.test(line));
    expect(curlLines.some(line => line.includes('METRICS_TOKEN_VALUE') && /-H\s/.test(line))).toBe(false);
    expect(script).toMatch(/printf 'header = "X-Metrics-Token: %s"\\n' "\$METRICS_TOKEN_VALUE" \| curl [^\n]*--config -/);
  });
});
