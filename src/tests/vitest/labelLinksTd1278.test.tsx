/**
 * Every form label names its field (v10.1.29, TD-1278, Vibe Farsi package 3b).
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { labelGapsOfSource, repositoryLabelGaps } from '../../../scripts/label-links';
import { TreasuryVoidModal } from '../../components/accounting/treasury/TreasuryVoidModal';
import { SearchableSelect } from '../../components/SearchableSelect';
import { JalaliDateInput } from '../../components/common/JalaliDateInput';
import type { TreasuryTransaction } from '../../types';

const PROBE = `
export const Probe = ({ id }: { id: string }) => (
  <form>
    <div><label>مبلغ</label><input value={a} /></div>
    <div><label htmlFor={id}>شرح</label><textarea id={id} /></div>
    <div><label>طرف حساب</label><div className="box"><SearchableSelect value={b} /></div></div>
    <div><label><input type="checkbox" /> فعال</label></div>
    <div><label>پیوست</label><input type="file" /></div>
    <div><label htmlFor="date">تاریخ</label><JalaliDateInput value={c} /></div>
    <div><label>انبارها</label><div>{rows.map((r) => <input key={r.id} />)}</div></div>
  </form>
);
`;

const REASON = 'دلیل ابطال';
const PARTY = 'طرف حساب';
const DUE_DATE = 'تاریخ سررسید';

describe('label_links_td_1278', () => {
  afterEach(cleanup);

  it('the scanner finds a label that does not point to its field and accepts linked, wrapping and list labels', () => {
    const gaps = labelGapsOfSource(PROBE, 'src/components/Probe.tsx');
    expect(gaps.map((gap) => `${gap.line} ${gap.field} ${gap.problem}`)).toEqual([
      '4 input unlinked',
      '6 SearchableSelect unlinked',
      '9 JalaliDateInput id-mismatch',
    ]);
  });

  it('no label in pages and components is left without its field', () => {
    const gaps = repositoryLabelGaps();
    expect(gaps.map((gap) => `${gap.file}:${gap.line} ${gap.field} ${gap.problem}`)).toEqual([]);
  }, 60_000);

  it('a label names its field in a real form', () => {
    const target = { id: 7, transactionNumber: 'TR-7', amount: 1000, bankAccountTitle: 'صندوق' } as unknown as TreasuryTransaction;
    render(<TreasuryVoidModal target={target} onClose={() => undefined} onConfirm={async () => undefined} />);
    expect(screen.getByLabelText(new RegExp(REASON)).tagName).toBe('TEXTAREA');
  });

  it('the shared pick list and date field take the id of their label', () => {
    render(
      <div>
        <label htmlFor="party">{PARTY}</label>
        <SearchableSelect id="party" value="" onChange={() => undefined} options={[]} />
        <label htmlFor="due">{DUE_DATE}</label>
        <JalaliDateInput id="due" value="" onChange={() => undefined} />
      </div>,
    );
    expect(screen.getByLabelText(PARTY).tagName).toBe('BUTTON');
    expect(screen.getByLabelText(DUE_DATE).tagName).toBe('INPUT');
  });
});
