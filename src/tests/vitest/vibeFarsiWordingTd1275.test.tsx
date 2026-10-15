/**
 * v10.1.26 (TD-1275, Vibe Farsi audit item 4): the screens say «جست‌وجو», «کنید», «است» and «نیست» (never «جستجو»,
 * «نمایید», «می‌باشد» or «نمی‌باشد»; the UI wording ratchet counts them), no Persian heading gets letter spacing
 * (`tracking-*` breaks the joined Persian letters), and no screen uses the browser's alert or confirm window: an error
 * shows under its form and a confirmation uses `confirmAction`.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { countFileSites } from '../../../scripts/ui-wording-ratchet';
import { TreasuryVoidModal } from '../../components/accounting/treasury/TreasuryVoidModal';
import { transferFormError } from '../../components/accounting/treasury/TreasuryTransferModal';
import type { TreasuryTransaction } from '../../types';

const ROOTS = ['src/pages', 'src/components', 'src/hooks', 'src/contexts'];
const PERSIAN = /[؀-ۿ]/;
const TRACKING = /\btracking-(tight|tighter|wide|wider|widest)\b/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Native alert / confirm calls, and JSX elements with letter spacing whose own text is Persian */
function scan(source: string, file: string): { nativeDialogs: string[]; spacedPersian: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nativeDialogs: string[] = [];
  const spacedPersian: string[] = [];
  const at = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) && callee.expression.getText(sf) === 'window' ? callee.name.text : '';
      if (name === 'alert' || (name === 'confirm' && !ts.isIdentifier(callee))) nativeDialogs.push(at(node));
      if (name === 'confirm' && ts.isIdentifier(callee) && node.arguments.length > 0) nativeDialogs.push(at(node));
    }
    if (ts.isJsxElement(node)) {
      const className = node.openingElement.attributes.properties.find(
        (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className',
      );
      const ownText = node.children.filter(ts.isJsxText).map(t => t.text).join('');
      if (className && TRACKING.test(className.getText(sf)) && PERSIAN.test(ownText)) spacedPersian.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { nativeDialogs, spacedPersian };
}

const ZWNJ = '‌';
const SEARCH_OLD = String.fromCodePoint(0x62c, 0x633, 0x62a, 0x62c, 0x648);
const FORMAL_DO = String.fromCodePoint(0x646, 0x645, 0x627, 0x6cc, 0x6cc, 0x62f);
const FORMAL_IS = `${String.fromCodePoint(0x645, 0x6cc)}${ZWNJ}${String.fromCodePoint(0x628, 0x627, 0x634, 0x62f)}`;

describe('vibe_farsi_wording_td_1275', () => {
  it('the wording ratchet counts the old search word and the formal verb forms, not their replacements', () => {
    expect(countFileSites(`const a = '${SEARCH_OLD}...';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = '${SEARCH_OLD}${String.fromCodePoint(0x6cc)} x';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = 'x ${FORMAL_DO}.';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = 'x ${FORMAL_IS}';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = 'x ${String.fromCodePoint(0x646)}${FORMAL_IS}';`, 'a.ts')).toBe(1);
    expect(countFileSites("const a = 'جست‌وجو و انتخاب'; const b = 'وارد کنید'; const c = 'خالی است';", 'a.ts')).toBe(0);
  });

  it('no screen calls the browser alert or confirm window, and no Persian heading has letter spacing', () => {
    const native: string[] = [];
    const spaced: string[] = [];
    for (const file of ROOTS.flatMap(dir => sourceFiles(path.join(process.cwd(), dir)))) {
      const rel = path.relative(process.cwd(), file);
      const found = scan(fs.readFileSync(file, 'utf8'), rel);
      native.push(...found.nativeDialogs);
      spaced.push(...found.spacedPersian);
    }
    expect(native).toEqual([]);
    expect(spaced).toEqual([]);
  });

  it('the scanner finds a native alert, window.confirm and a spaced Persian heading', () => {
    const found = scan(
      "alert('x'); window.confirm('y'); const h = <h1 className=\"font-bold tracking-tight\">عنوان</h1>; const c = <span className=\"tracking-widest\">1234</span>;",
      'probe.tsx',
    );
    expect(found.nativeDialogs).toHaveLength(2);
    expect(found.spacedPersian).toHaveLength(1);
  });

  it('the transfer form says what is wrong instead of an alert window', () => {
    expect(transferFormError({ fromBankAccountId: null, toBankAccountId: 2, amount: 10 })).toBe('لطفاً حساب‌های مبدأ و مقصد را انتخاب کنید.');
    expect(transferFormError({ fromBankAccountId: 2, toBankAccountId: 2, amount: 10 })).toBe('حساب مبدأ و مقصد نمی‌توانند یکسان باشند.');
    expect(transferFormError({ fromBankAccountId: 1, toBankAccountId: 2, amount: 0 })).toBe('مبلغ انتقال باید بزرگ‌تر از صفر باشد.');
    expect(transferFormError({ fromBankAccountId: 1, toBankAccountId: 2, amount: 10 })).toBe('');
  });

  it('the treasury void window shows a missing reason under its field', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onConfirm = vi.fn(async () => undefined);
    const target = { id: 7, transactionNumber: 'TR-7', amount: 1000, bankAccountTitle: 'صندوق' } as unknown as TreasuryTransaction;
    render(<TreasuryVoidModal target={target} onClose={() => undefined} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /ابطال/ }));
    expect(screen.getByRole('alert').textContent).toBe('لطفاً دلیل ابطال تراکنش را وارد کنید.');
    expect(screen.getByPlaceholderText(/اشتباه در مبلغ/).getAttribute('aria-invalid')).toBe('true');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
