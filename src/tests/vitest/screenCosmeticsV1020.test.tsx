/**
 * v10.2.0: small screen faults found while taking the user guide pictures of 10.1. The invoice details window kept an
 * empty frame where the removed «آغاز گردش کار» box was; the login button said «ورود به سیستم»; the health page cards
 * showed the server folders in the open; the settings group «انبار و موجودی کالا» still named the removed negative stock
 * control.
 */
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));
vi.mock('../../components/invoices/list/InvoiceDetailsInfoCards', () => ({ InvoiceDetailsInfoCards: () => <section data-part="info" /> }));
vi.mock('../../components/invoices/list/InvoiceDetailsItemsTable', () => ({ InvoiceDetailsItemsTable: () => <section data-part="items" /> }));
vi.mock('../../components/invoices/list/InvoiceDetailsTotals', () => ({ InvoiceDetailsTotals: () => <section data-part="totals" /> }));
vi.mock('../../components/invoices/list/InvoiceDetailsSettlementCard', () => ({ InvoiceDetailsSettlementCard: () => <section data-part="settlement" /> }));

import { InvoiceDetailsModal } from '../../components/invoices/list/InvoiceDetailsModal';
import { StorageHealthCard } from '../../components/system/StorageHealthCard';
import { MediaLibraryHealthCard } from '../../components/system/MediaLibraryHealthCard';
import { STORAGE_LOCATION_MESSAGES } from '../../lib/system/storageHealth';
import { SETTINGS_GROUPS } from '../../components/settings/settingsNavigationConfig';
import type { InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';

const OLD_LOGIN_WORD = 'سیستم';
const LOGIN_BUTTON = 'ورود به سامانه';
const NEGATIVE_STOCK = 'موجودی منفی';
const INVENTORY_GROUP = 'انبار و موجودی کالا';
const ATTACHMENTS_DIR = '/srv/erp/attachments';
const MEDIA_DIR = '/opt/papital-erp/media-library';

afterEach(cleanup);

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('screen_cosmetics_v10_2_0', () => {
  it('the invoice details window has no empty frame when the document has no workflow', () => {
    const doc = { id: 7, type: 'invoice', ref_number: '1405-7', date: '2026-10-01', user: 'ali' } as unknown as InvoiceListDocument;
    const { container } = render(
      <InvoiceDetailsModal selectedDocDetails={doc} setSelectedDocDetails={() => {}} setSettlementDoc={() => {}}
        printFromDetails={() => {}} loadData={() => {}} canSettle={false} />,
    );
    const body = container.querySelector('[data-part="info"]')?.parentElement as HTMLElement;
    const emptyChildren = Array.from(body.children).filter(el => el.children.length === 0 && !(el.textContent ?? '').trim() && !el.hasAttribute('data-part'));
    expect(emptyChildren).toHaveLength(0);
  });

  it('the login page says سامانه, never سیستم', () => {
    const source = read('src/pages/LoginPage.tsx');
    expect(source).toContain(`'${LOGIN_BUTTON}'`);
    expect(source).not.toContain(OLD_LOGIN_WORD);
  });

  it('the inventory settings group no longer names the removed negative stock control', () => {
    const group = SETTINGS_GROUPS.find(g => g.title === INVENTORY_GROUP);
    expect(group?.description).toBeTruthy();
    expect(group?.description).not.toContain(NEGATIVE_STOCK);
  });

  it('the storage and media cards keep server folders inside the closed technical details', () => {
    const storage = render(<StorageHealthCard storage={{
      status: 'ok', writable: true, message: '',
      locations: [{ kind: 'attachments', path: ATTACHMENTS_DIR, writable: true, message: STORAGE_LOCATION_MESSAGES.attachments.ok }],
    }} />);
    const storagePath = Array.from(storage.container.querySelectorAll('p')).find(p => p.textContent === ATTACHMENTS_DIR);
    expect(storagePath?.closest('details')).toBeTruthy();
    expect(storagePath?.closest('details')?.open).toBe(false);
    cleanup();

    const media = render(<MediaLibraryHealthCard media={{
      status: 'ok', path: MEDIA_DIR, fileCount: 1, imageCount: 1, videoCount: 0,
    } as unknown as Parameters<typeof MediaLibraryHealthCard>[0]['media']} />);
    const mediaPath = Array.from(media.container.querySelectorAll('p')).find(p => p.textContent === MEDIA_DIR);
    expect(mediaPath?.closest('details')).toBeTruthy();
    expect(mediaPath?.closest('details')?.open).toBe(false);
  });
});
