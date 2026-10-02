import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PillBadge, resolvePillVariant, type PillBadgeVariants } from '../../components/common/PillBadge';
import {
  REQUISITION_PRIORITY_BADGES,
  REQUISITION_PRIORITY_DETAIL_BADGES,
  REQUISITION_PRIORITY_DETAIL_FALLBACK,
  REQUISITION_PRIORITY_FALLBACK,
  REQUISITION_STATUS_BADGES,
  REQUISITION_STATUS_FALLBACK,
} from '../../components/procurement/requisitionBadges';

afterEach(cleanup);

const VARIANTS: PillBadgeVariants = {
  ok: { label: 'تایید', className: 'bg-emerald-100' },
};

describe('PillBadge (TD-108)', () => {
  it('renders the label and class of the matching variant', () => {
    render(<PillBadge variants={VARIANTS} value="ok" />);
    expect(screen.getByText('تایید').className).toBe('bg-emerald-100');
  });

  it('uses the fallback for unknown values and renders nothing without one', () => {
    const { container } = render(<PillBadge variants={VARIANTS} value="other" />);
    expect(container.innerHTML).toBe('');
    render(<PillBadge variants={VARIANTS} value="other" fallback={{ label: 'نامشخص', className: 'bg-slate-100' }} />);
    expect(screen.getByText('نامشخص')).toBeTruthy();
  });

  it('shows the raw value when the variant has no label, and an explicit label overrides it', () => {
    render(<PillBadge variants={VARIANTS} value="draft_x" fallback={{ className: 'bg-slate-100' }} />);
    expect(screen.getByText('draft_x')).toBeTruthy();
    render(<PillBadge variants={VARIANTS} value="ok" label="در حال انجام (۵۰٪)" />);
    expect(screen.getByText('در حال انجام (۵۰٪)').className).toBe('bg-emerald-100');
  });

  it('never resolves inherited object keys', () => {
    expect(resolvePillVariant(VARIANTS, 'toString')).toBeUndefined();
    expect(resolvePillVariant(VARIANTS, undefined)).toBeUndefined();
  });
});

describe('requisition badges keep their wording and colours', () => {
  it('maps every workflow status to the same badge as before', () => {
    const label = (s: string) => resolvePillVariant(REQUISITION_STATUS_BADGES, s, REQUISITION_STATUS_FALLBACK)?.label;
    expect(['pending', 'under_review', 'manager_approval'].map(label)).toEqual(Array(3).fill('در انتظار بررسی و تایید'));
    expect(['ordered', 'approved'].map(label)).toEqual(Array(2).fill('تایید شده (در حال خرید)'));
    expect(['received', 'completed'].map(label)).toEqual(Array(2).fill('خرید و تحویل انبار شده'));
    expect(['rejected', 'cancelled'].map(label)).toEqual(Array(2).fill('رد شده / لغو'));
    render(<PillBadge variants={REQUISITION_STATUS_BADGES} value="draft" fallback={REQUISITION_STATUS_FALLBACK} />);
    expect(screen.getByText('draft').className).toContain('bg-slate-100');
  });

  it('keeps the short list labels and the long detail labels', () => {
    render(<PillBadge variants={REQUISITION_PRIORITY_BADGES} value="urgent" fallback={REQUISITION_PRIORITY_FALLBACK} />);
    expect(screen.getByText('فوری').className).toContain('animate-pulse');
    render(<PillBadge variants={REQUISITION_PRIORITY_DETAIL_BADGES} value={undefined} fallback={REQUISITION_PRIORITY_DETAIL_FALLBACK} />);
    expect(screen.getByText('اولویت عادی').className).toContain('bg-blue-100');
  });
});
