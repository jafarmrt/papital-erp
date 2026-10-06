import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels';

// Workflow UI and API wording (package 14, B14-28 / TD-470, owner decision t10 and package 16 decision 7): Persian text of
// the workflow pages and messages has no English term, no transliteration outside «کاردکس»/«ترنسفر»/«وبهوک», no Latin
// digits, no raw WF_* code and no «با موفقیت … گردید» / «کاربر گرامی».

const ROOT = join(__dirname, '..', '..');
const PERSIAN = /[؀-ۿ]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]*</g;
// stored audit keys keep their old text (AGENTS.md §6: «stored keys keep their text»)
const STORED_KEYS = new Set(['تفویض اختیار ورکفلو', 'ورکفلو ()']);

/** removes template placeholders, nested ones included: their content is code, not text */
function withoutPlaceholders(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '{') {
      let depth = 0;
      for (i += 1; i < line.length; i++) {
        if (line[i] === '{') depth++;
        else if (line[i] === '}' && --depth === 0) break;
      }
      continue;
    }
    out += line[i];
  }
  return out;
}

const PACKAGE_14 = [
  'components/workflow/', 'components/approval/', 'pages/ApprovalInboxPage.tsx', 'pages/WorkflowManagementPage.tsx',
  'hooks/queries/useWorkflowQueries.ts', 'hooks/useApprovalTaskEntity.ts', 'routes/workflow.routes.ts',
  'routes/workflowRouteSchemas.ts', 'services/workflow/', 'lib/workflow/',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
const files = sourceFiles(ROOT).filter(f => PACKAGE_14.some(p => rel(f).startsWith(p)));

/** Persian string literals and JSX text of a file; terminal output (logger / console) is English by its own rule */
function persianTexts(file: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = withoutPlaceholders(raw.trim());
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
    if (/\b(logger|console)\.\w+\(/.test(line)) return;
    const texts: string[] = [...(line.match(LITERAL) ?? [])];
    if (!/[<>{}'"`=;]/.test(line)) texts.push(line);
    for (const text of texts) {
      const visible = text.replace(/^[>'"`]|[<'"`]$/g, '');
      if (PERSIAN.test(visible) && !STORED_KEYS.has(visible)) found.push({ line: i + 1, text: visible });
    }
  });
  return found;
}

const offenders = (test: (text: string) => boolean) =>
  files.flatMap(f => persianTexts(f).filter(t => test(t.text)).map(t => `${rel(f)}:${t.line}: ${t.text}`));

describe('workflow wording in Persian text (TD-470)', () => {
  it('scans the workflow files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no English word or raw code', () => {
    expect(offenders(t => /[A-Za-z]{2,}/.test(t))).toEqual([]);
  });

  it('has no Latin digits', () => {
    expect(offenders(t => /[0-9]/.test(t))).toEqual([]);
  });

  it('names an entity type in Persian, an unknown one too', () => {
    expect(workflowEntityTypeLabel('purchase_requisition')).toBe('درخواست خرید');
    expect(workflowEntityTypeLabel('bank_account')).toBe('حساب بانکی');
    expect(workflowEntityTypeLabel('some_new_type')).toBe('پرونده');
  });

  it('has no transliteration or stock phrase', () => {
    expect(offenders(t => /ورکفلو|اکشن|متریال|(?<![؀-ۿ])لود(?![؀-ۿ])|گردید|کاربر گرامی|با موفقیت/.test(t))).toEqual([]);
  });
});
