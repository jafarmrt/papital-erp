import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { IN_FLIGHT_STILL_RUNNING_MESSAGE, UNCONFIRMED_MUTATION_MESSAGE } from '../../api';
import { SETUP_TOKEN_NOT_CONFIGURED_MESSAGE } from '../../lib/auth/setupRules';
import { isHiddenSearchKeyword } from '../../../scripts/ui-wording-ratchet';

/**
 * 10.3 (owner rule, ARCH review finding 7): the computer that runs the program is «سرور» in every text a person reads,
 * screens and server messages alike, never «کارساز» (decision t7 of v9 package 16 chose «کارساز»; the owner's later rule
 * replaces it). «خودکارسازی» is another word and stays. Comments, the changelogs and the tests are history, not shown text,
 * and the hidden settings search keywords keep the old word so an old search still finds its tab.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  retired: /(?<!خود)کارساز/,
  server: 'سرور',
} as const;

const SRC = path.join(__dirname, '..', '..');
const SKIPPED = [path.join(SRC, 'tests'), path.join(SRC, 'data', 'changelogs')];

function sourceFiles(dir: string): string[] {
  if (SKIPPED.includes(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** every string, template and JSX text in the source that still says the retired word, as file:line */
function retiredWordSites(): string[] {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!SHOWN.retired.test(source)) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
      ) {
        if (SHOWN.retired.test((node as ts.LiteralLikeNode).text) && !isHiddenSearchKeyword(node, sf)) {
          sites.push(`${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

describe('the server is named with one word (10.3)', () => {
  it('no screen text or server message uses the retired word', () => {
    expect(retiredWordSites()).toEqual([]);
  });

  it('the connection, in-flight and setup messages name the server with the decided word', () => {
    for (const message of [UNCONFIRMED_MUTATION_MESSAGE, IN_FLIGHT_STILL_RUNNING_MESSAGE, SETUP_TOKEN_NOT_CONFIGURED_MESSAGE]) {
      expect(message).toContain(SHOWN.server);
      expect(SHOWN.retired.test(message)).toBe(false);
    }
  });
});
