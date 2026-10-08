import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { planProjectReservation } from '../../lib/projects/projectReservation';
import { storedReservationShortages } from '../../lib/projects/projectReservationState';
import { ReservationShortageList } from '../../components/project/ReservationShortageList';

// v9.0.373 (TD-819, B07-03): finalizing reserves only the stock others do not hold and records the shortage
describe('project reservation of free stock (TD-819)', () => {
  const items = [
    { id: 1, code: 'A-1', name: 'سنگ', unit: 'عدد', currentStock: 30 },
    { id: 2, code: 'B-1', name: 'نخ', unit: 'متر', currentStock: 0 },
  ];
  const sections = [{ id: 's', title: 'مواد', checkType: 'global', globalItems: [
    { itemCode: 'A-1', unit: 'عدد', requiredQty: 30 },
    { itemCode: 'B-1', unit: 'متر', requiredQty: 5 },
  ] }];

  it('reserves min(need, stock - reservations of others) and lists every item reserved below its need', () => {
    const plan = planProjectReservation(sections, [], items, [], 'now', { reservedByOthers: new Map([[1, 24]]) });
    expect(plan.reserved).toEqual([expect.objectContaining({ itemId: 1, reservedQty: 6, originalQty: 30 })]);
    expect(plan.shortages).toEqual([
      { itemId: 1, itemCode: 'A-1', itemName: 'سنگ', unit: 'عدد', requiredQty: 30, reservedQty: 6, shortQty: 24, stock: 30, reservedByOthers: 24 },
      { itemId: 2, itemCode: 'B-1', itemName: 'نخ', unit: 'متر', requiredQty: 5, reservedQty: 0, shortQty: 5, stock: 0, reservedByOthers: 0 },
    ]);
  });

  it('reserves nothing and records the whole need when others hold more than the stock', () => {
    const plan = planProjectReservation(sections, [], items, [], 'now', { reservedByOthers: new Map([[1, 40]]) });
    expect(plan.reserved).toEqual([]);
    expect(plan.shortages[0]).toMatchObject({ itemId: 1, reservedQty: 0, shortQty: 30 });
  });

  it('reads the stored shortage and shows it in Persian digits with the unit after the number', () => {
    const shortages = storedReservationShortages({ reservationShortages: [
      { itemId: 1, itemCode: 'A-1', itemName: 'سنگ', unit: 'عدد', requiredQty: 30, reservedQty: 6, shortQty: 24, stock: 30, reservedByOthers: 24 },
      'broken',
    ] });
    expect(shortages).toHaveLength(1);
    expect(storedReservationShortages({})).toEqual([]);
    render(<ReservationShortageList shortages={shortages} />);
    expect(screen.getByText('کمبود رزرو هنگام ثبت نهایی')).toBeTruthy();
    expect(screen.getAllByText('۲۴ عدد')).toHaveLength(2);
    expect(screen.getByText('۶ عدد')).toBeTruthy();
  });

  it('renders nothing without a shortage', () => {
    const { container } = render(<ReservationShortageList shortages={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
