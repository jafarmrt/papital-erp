/**
 * v9.0.382 (TD-713, B15-11): the fields the rule editor offers for an event are the fields of its real payload: the
 * invoice and purchase events carry the payable amount, every published type has its fields, and a type nothing
 * publishes has none.
 */
import { describe, expect, it } from 'vitest';
import { COMMON_EVENT_FIELDS, eventFieldOptions } from '../../lib/eventPayloadFields';
import { PUBLISHED_EVENT_TYPES } from '../../lib/events/eventTypeCatalog';

describe('event payload fields of the rule editor (TD-713)', () => {
  it('offers payload fields for every published event type', () => {
    for (const type of PUBLISHED_EVENT_TYPES) {
      expect(eventFieldOptions(type.value).length, type.value).toBeGreaterThan(COMMON_EVENT_FIELDS.length);
    }
  });

  it('offers the payable amount of invoice and purchase events', () => {
    for (const type of ['InvoiceCreated', 'InvoiceApproved', 'PurchaseCreated', 'PurchaseApproved']) {
      const paths = eventFieldOptions(type).map(f => f.path);
      expect(paths).toEqual(expect.arrayContaining(['payload.totalAmount', 'payload.netAmount', 'payload.vatAmount', 'payload.serviceChargeAmount', 'payload.totalAmountIrr']));
    }
  });

  it('offers no payload field for a type nothing publishes', () => {
    for (const type of ['InvoiceCancelled', 'PurchaseReceived', 'ChequeStatusChanged', 'WorkflowApprovalProgress']) {
      expect(eventFieldOptions(type)).toEqual(COMMON_EVENT_FIELDS);
    }
  });
});
