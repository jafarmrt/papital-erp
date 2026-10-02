import { describe, expect, it } from 'vitest';
import {
  buildGlobalReservations,
  deductProjectReservations,
  itemReservationSummary,
  reservationMatchesItem,
  reservationMatchesListItem,
  storedReservationMatchesItem,
  type GlobalReservation,
} from '../../lib/documents/stockReservations';

// TD-080 part 3: characterization tests — expected values follow the logic that lived in DocumentsPage.tsx before the split.

function reservation(overrides: Partial<GlobalReservation>): GlobalReservation {
  return { projectCode: '', projectTitle: '', itemCode: '', itemName: '', reservedQty: 0, unit: 'عدد', ...overrides };
}

const stone = { id: 3, code: 'RM-3', name: 'سنگ فیروزه', current_stock: 10 };

describe('buildGlobalReservations', () => {
  it('maps /inventory/reserved-items entries with the page defaults', () => {
    const list = buildGlobalReservations({
      allReservationEntries: [
        { sourceType: 'project', sourceId: 7, sourceRef: 'PRJ-7', sourceTitle: 'گردنبند', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ', reservedQty: '2.5', unit: 'گرم', date: '1405/07/01' },
        { sourceType: 'proforma', sourceId: 11, sourceRef: 'PF-1', itemCode: 'RM-4', reservedQty: 1 },
        { sourceLabel: 'برچسب', sourceId: 12 },
      ],
    }, [{ id: 99, project_code: 'IGNORED', inventory_control: { reservedItems: [{ itemId: 1, reservedQty: 1 }] } }]);

    expect(list).toEqual([
      { sourceType: 'project', sourceLabel: 'پروژه', projectId: 7, projectCode: 'PRJ-7', projectTitle: 'گردنبند', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ', reservedQty: 2.5, unit: 'گرم', reservedAt: '1405/07/01' },
      { sourceType: 'proforma', sourceLabel: 'پیش‌فاکتور', projectId: undefined, projectCode: 'PF-1', projectTitle: '', itemId: undefined, itemCode: 'RM-4', itemName: '', reservedQty: 1, unit: 'عدد', reservedAt: undefined },
      { sourceType: undefined, sourceLabel: 'برچسب', projectId: undefined, projectCode: '', projectTitle: '', itemId: undefined, itemCode: '', itemName: '', reservedQty: 0, unit: 'عدد', reservedAt: undefined },
    ]);
  });

  it('falls back to the projects\' inventory_control.reservedItems when the endpoint has no entries', () => {
    const projects = [
      { id: 7, project_code: 'PRJ-7', title: 'گردنبند', inventory_control: { reservedItems: [{ itemId: 3, itemCode: 'RM-3', itemName: 'سنگ', reservedQty: 4, unit: 'عدد', reservedAt: '2026-10-01' }] } },
      { id: 8, inventoryControl: { reservedItems: [{ itemCode: 'RM-4', reservedQty: '3' }] } },
      { id: 9, project_code: 'PRJ-9', inventory_control: { reservedItems: [] } },
      { id: 10, project_code: 'PRJ-10' },
    ];
    const expected = [
      { sourceType: 'project', sourceLabel: 'پروژه', projectId: 7, projectCode: 'PRJ-7', projectTitle: 'گردنبند', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ', reservedQty: 4, unit: 'عدد', reservedAt: '2026-10-01' },
      { sourceType: 'project', sourceLabel: 'پروژه', projectId: 8, projectCode: 'PRJ-8', projectTitle: 'بدون عنوان', itemId: undefined, itemCode: 'RM-4', itemName: '', reservedQty: 3, unit: 'عدد', reservedAt: undefined },
    ];
    expect(buildGlobalReservations({ allReservationEntries: [] }, projects)).toEqual(expected);
    expect(buildGlobalReservations(undefined, projects)).toEqual(expected);
    expect(buildGlobalReservations(null, [])).toEqual([]);
  });
});

describe('item ↔ reservation matching rules', () => {
  it('matches by id, else code (case-insensitive, trimmed), else name', () => {
    for (const matches of [reservationMatchesItem, reservationMatchesListItem]) {
      expect(matches(reservation({ itemId: '3' }), stone)).toBe(true);
      expect(matches(reservation({ itemId: 4, itemCode: ' rm-3 ' }), stone)).toBe(true);
      expect(matches(reservation({ itemName: ' سنگ فیروزه ' }), stone)).toBe(true);
      expect(matches(reservation({ itemId: 4, itemCode: 'RM-4', itemName: 'نخ' }), stone)).toBe(false);
      expect(matches(reservation({}), stone)).toBe(false);
    }
    expect(storedReservationMatchesItem({ itemId: '3' }, stone)).toBe(true);
    expect(storedReservationMatchesItem({ itemCode: ' rm-3 ' }, stone)).toBe(true);
    expect(storedReservationMatchesItem({ itemName: 'سنگ فیروزه' }, stone)).toBe(true);
    expect(storedReservationMatchesItem({ itemId: 4, itemCode: 'RM-4' }, stone)).toBe(false);
  });

  it('keeps each call site\'s own edge semantics', () => {
    // summary and deduction require a truthy item id; the list/document rule does not
    const zeroIdItem = { id: 0, code: 'X', name: 'Y' };
    expect(reservationMatchesItem(reservation({ itemId: '0' }), zeroIdItem)).toBe(false);
    expect(reservationMatchesListItem(reservation({ itemId: '0' }), zeroIdItem)).toBe(true);
    expect(storedReservationMatchesItem({ itemId: '0' }, zeroIdItem)).toBe(false);
    // summary / list compare codes with toUpperCase, the deduction with toLowerCase ('ß'.toUpperCase() === 'SS')
    const ssItem = { id: 50, code: 'ss', name: 'n' };
    expect(reservationMatchesItem(reservation({ itemCode: 'ß' }), ssItem)).toBe(true);
    expect(reservationMatchesListItem(reservation({ itemCode: 'ß' }), ssItem)).toBe(true);
    expect(storedReservationMatchesItem({ itemCode: 'ß' }, ssItem)).toBe(false);
    // the deduction stringifies stored values (a numeric code still matches)
    expect(storedReservationMatchesItem({ itemCode: 123 as unknown as string }, { id: 51, code: '123', name: 'n' })).toBe(true);
  });
});

describe('itemReservationSummary', () => {
  const reservations = [
    reservation({ sourceType: 'project', projectId: 7, projectCode: 'PRJ-7', itemId: 3, reservedQty: 4 }),
    reservation({ sourceType: 'project', projectId: '8', projectCode: 'PRJ-8', itemCode: 'rm-3 ', reservedQty: 3 }),
    reservation({ sourceType: 'proforma', projectCode: 'PF-1', itemName: 'سنگ فیروزه', reservedQty: 1 }),
    reservation({ sourceType: 'project', projectId: 7, itemId: 9, itemCode: 'RM-9', reservedQty: 5 }),
  ];

  it('splits the selected project from other reservations and caps the exit quantity', () => {
    const s = itemReservationSummary(reservations, stone, '7');
    expect(s.matchingReservations).toEqual(reservations.slice(0, 3));
    expect(s.totalReservedQty).toBe(8);
    expect(s.reservedForSelectedProject).toBe(4);
    expect(s.reservedForOtherProjects).toBe(4);
    expect(s.maxAllowedForExit).toBe(6);
  });

  it('treats every reservation as foreign when no project is selected', () => {
    const s = itemReservationSummary(reservations, stone, '');
    expect(s.reservedForSelectedProject).toBe(0);
    expect(s.reservedForOtherProjects).toBe(8);
    expect(s.maxAllowedForExit).toBe(2);
  });

  it('compares project ids as strings and never goes below zero', () => {
    const s = itemReservationSummary(reservations, { ...stone, current_stock: 5 }, '8');
    expect(s.reservedForSelectedProject).toBe(3);
    expect(s.reservedForOtherProjects).toBe(5);
    expect(s.maxAllowedForExit).toBe(0);
  });

  it('allows the whole stock for an item without reservations', () => {
    const s = itemReservationSummary(reservations, { id: 20, code: 'P-20', name: 'گوشواره', current_stock: 6 }, '7');
    expect(s.matchingReservations).toEqual([]);
    expect(s.totalReservedQty).toBe(0);
    expect(s.maxAllowedForExit).toBe(6);
  });
});

describe('deductProjectReservations', () => {
  it('deducts issued quantities, removes fully consumed rows and leaves the input untouched', () => {
    const stored = [
      { itemId: 3, reservedQty: 4, unit: 'عدد', note: 'keep' },
      { itemCode: 'RM-4', reservedQty: '1' },
      { itemName: 'طلا', reservedQty: 5 },
    ];
    const snapshot = JSON.parse(JSON.stringify(stored));
    const result = deductProjectReservations(stored, [
      { item: { id: 3, code: 'RM-3', name: 'سنگ' }, quantity: 2 },
      { item: { id: 4, code: 'rm-4', name: 'نخ' }, quantity: 3 },
      { item: { id: 5, code: 'P-5', name: 'نقره' }, quantity: 1 },
      { item: { id: 6, code: 'P-6', name: 'طلا' }, quantity: 0 },
    ]);
    expect(result.totalDeducted).toBe(3);
    expect(result.reservedItems).toEqual([
      { itemId: 3, reservedQty: 2, unit: 'عدد', note: 'keep' },
      { itemName: 'طلا', reservedQty: 5 },
    ]);
    expect(stored).toEqual(snapshot);
  });

  it('deducts each issued line from the first matching row only', () => {
    const result = deductProjectReservations(
      [{ itemId: 3, reservedQty: 2 }, { itemId: 3, reservedQty: 5 }],
      [{ item: { id: 3, code: 'RM-3', name: 'سنگ' }, quantity: 4 }],
    );
    expect(result.totalDeducted).toBe(2);
    expect(result.reservedItems).toEqual([{ itemId: 3, reservedQty: 5 }]);
  });

  it('returns an empty list when the project has no stored reservations', () => {
    expect(deductProjectReservations(undefined, [{ item: stone, quantity: 1 }])).toEqual({ reservedItems: [], totalDeducted: 0 });
  });
});
