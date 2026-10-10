import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
}));

import { useProcurementAccess } from '../../hooks/procurement/useProcurementAccess';
import { canOrderRequisition } from '../../lib/procurement/requisitionFields';

// TD-1126: after OBS-R2-36 the purchase requisition workflow guards approve, reject and cancel with procurement.approve
// and reopen with procurement.create; the buttons follow those guards, not procurement.manage.

afterEach(() => { cleanup(); granted.clear(); });

function accessWith(keys: string[]) {
  keys.forEach(k => granted.add(k));
  return renderHook(() => useProcurementAccess()).result.current;
}

describe('procurement buttons follow the workflow guards (TD-1126)', () => {
  it('a buyer with procurement.manage only sees no approve, reject or cancel and no order of a pending requisition', () => {
    const access = accessWith(['procurement.view', 'procurement.manage', 'procurement.order']);
    expect(access.canApprove).toBe(false);
    expect(canOrderRequisition({ status: 'pending', items: [] }, access)).toBe(false);
  });

  it('procurement.approve approves; reopen needs procurement.create too', () => {
    const approver = accessWith(['procurement.view', 'procurement.approve']);
    expect(approver.canApprove).toBe(true);
    expect(approver.canReopen).toBe(false);
    cleanup(); granted.clear();
    const reopener = accessWith(['procurement.view', 'procurement.manage', 'procurement.create']);
    expect(reopener.canReopen).toBe(true);
  });
});
