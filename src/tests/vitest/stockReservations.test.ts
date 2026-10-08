import { describe, expect, it } from 'vitest';
import {
  buildGlobalReservations,
  itemReservationSummary,
  reservationMatchesItem,
  reservationMatchesListItem,
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

  it('falls back to the finalized projects\' inventory_control.reservedItems when the endpoint has no entries', () => {
    const projects = [
      { id: 7, project_code: 'PRJ-7', title: 'گردنبند', inventory_control: { isFinalized: true, reservedItems: [{ itemId: 3, itemCode: 'RM-3', itemName: 'سنگ', reservedQty: 4, unit: 'عدد', reservedAt: '2026-10-01' }] } },
      { id: 8, inventoryControl: { isFinalized: true, reservedItems: [{ itemCode: 'RM-4', reservedQty: '3' }] } },
      { id: 9, project_code: 'PRJ-9', inventory_control: { isFinalized: true, reservedItems: [] } },
      { id: 10, project_code: 'PRJ-10' },
      // v9.0.349 (TD-817): a stored reservation of a project that is not finalized reserves nothing
      { id: 11, project_code: 'PRJ-11', inventory_control: { isFinalized: false, reservedItems: [{ itemCode: 'RM-5', reservedQty: 2 }] } },
      { id: 12, project_code: 'PRJ-12', inventory_control: { reservedItems: [{ itemCode: 'RM-6', reservedQty: 2 }] } },
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
  });

  it('keeps each call site\'s own edge semantics', () => {
    // the summary requires a truthy item id; the list/document rule does not
    const zeroIdItem = { id: 0, code: 'X', name: 'Y' };
    expect(reservationMatchesItem(reservation({ itemId: '0' }), zeroIdItem)).toBe(false);
    expect(reservationMatchesListItem(reservation({ itemId: '0' }), zeroIdItem)).toBe(true);
    // summary / list compare codes with toUpperCase ('ß'.toUpperCase() === 'SS')
    const ssItem = { id: 50, code: 'ss', name: 'n' };
    expect(reservationMatchesItem(reservation({ itemCode: 'ß' }), ssItem)).toBe(true);
    expect(reservationMatchesListItem(reservation({ itemCode: 'ß' }), ssItem)).toBe(true);
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

  it('caps the exit by the stock of the selected warehouse, like computeSellable on the server (TD-799)', () => {
    // v9.0.242 (B08-30): انبار WH1 صفر و WH2 ده عدد؛ پیش‌تر سقف حواله از WH1 هم ده بود و سرور سند را رد می‌کرد
    const split = { ...stone, current_stock: 10, stocks: { WH1: 0, WH2: 10 }, stock_WH1: 0, stock_WH2: 10 };
    expect(itemReservationSummary([], split, '', 'WH1').maxAllowedForExit).toBe(0);
    expect(itemReservationSummary([], split, '', 'WH1').locationStock).toBe(0);
    expect(itemReservationSummary([], split, '', 'WH2').maxAllowedForExit).toBe(10);
    // both limits apply: min(warehouse stock, total − other reservations)
    expect(itemReservationSummary(reservations, split, '7', 'WH2').maxAllowedForExit).toBe(6);
    const threeAndSeven = { ...split, stocks: { WH1: 3, WH2: 7 }, stock_WH1: 3, stock_WH2: 7 };
    expect(itemReservationSummary(reservations, threeAndSeven, '7', 'WH1').maxAllowedForExit).toBe(3);
    // a warehouse the item has no row in holds nothing; no warehouse means the whole stock
    expect(itemReservationSummary([], split, '', 'WH9').maxAllowedForExit).toBe(0);
    expect(itemReservationSummary([], split, '').maxAllowedForExit).toBe(10);
  });

  it('allows the whole stock for an item without reservations', () => {
    const s = itemReservationSummary(reservations, { id: 20, code: 'P-20', name: 'گوشواره', current_stock: 6 }, '7');
    expect(s.matchingReservations).toEqual([]);
    expect(s.totalReservedQty).toBe(0);
    expect(s.maxAllowedForExit).toBe(6);
  });
});
