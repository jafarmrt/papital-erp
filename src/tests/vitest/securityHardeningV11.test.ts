// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { keepBeyondGrant } from '../../lib/permissions/grantBoundary';
import { sniffInlineSafeType } from '../../lib/fileSignature';
import {
  PERSONNEL_USER_LINK_LOCKED_HINT, PERSONNEL_USER_RELINK_HINT, personnelUserPickerRule,
} from '../../lib/personnel/personnelUserLinks';

// v11 phase 6.2 (security, card ت۵۶-۸): the browser halves of X5, X6 and X16 that the security suite drives only
// through the server.

describe('keepBeyondGrant (X5): the role form never removes a key its user cannot give back', () => {
  it('lets the system admin remove anything', () => {
    expect(keepBeyondGrant('all', ['customers.view', 'accounting.view'], [])).toEqual([]);
  });

  it('puts back a key the editor lacks and keeps the removal of its own key', () => {
    expect(keepBeyondGrant(['customers.view'], ['customers.view', 'accounting.view'], [])).toEqual(['accounting.view']);
  });

  it('puts back the requirement of a kept key too', () => {
    const next = keepBeyondGrant(['products.view'], ['products.view', 'products.create'], []);
    expect(next).toContain('products.create');
    expect(next).toContain('products.view');
  });

  it('leaves an addition or an unchanged list as it is', () => {
    expect(keepBeyondGrant(['customers.view'], ['accounting.view'], ['accounting.view', 'customers.view'])).toEqual(['accounting.view', 'customers.view']);
  });
});

describe('sniffInlineSafeType (X16): the bytes, not the declared type, make a file an image or a PDF', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  it('names each inline-safe type by its signature', () => {
    expect(sniffInlineSafeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffInlineSafeType(png)).toBe('image/png');
    expect(sniffInlineSafeType(Buffer.from('GIF89a…', 'latin1'))).toBe('image/gif');
    expect(sniffInlineSafeType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffInlineSafeType(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe('application/pdf');
  });

  it('accepts a PDF header within the first 1024 bytes, as readers do, and not later', () => {
    expect(sniffInlineSafeType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('%PDF-1.4', 'latin1')]))).toBe('application/pdf');
    expect(sniffInlineSafeType(Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from('%PDF-1.4', 'latin1')]))).toBeNull();
  });

  it('refuses HTML, script and a truncated signature', () => {
    expect(sniffInlineSafeType(Buffer.from('<html><script>alert(1)</script></html>', 'utf8'))).toBeNull();
    expect(sniffInlineSafeType(Buffer.from('<svg onload="alert(1)"/>', 'utf8'))).toBeNull();
    expect(sniffInlineSafeType(png.subarray(0, 4))).toBeNull();
    expect(sniffInlineSafeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('personnelUserPickerRule (X6): the account picker follows the server rule', () => {
  it('locks the picker on the stored account without users.manage', () => {
    expect(personnelUserPickerRule(false, '7')).toEqual({ locked: true, onlyStored: true, hint: PERSONNEL_USER_LINK_LOCKED_HINT });
    expect(personnelUserPickerRule(false, '')).toEqual({ locked: true, onlyStored: true, hint: PERSONNEL_USER_LINK_LOCKED_HINT });
  });

  it('offers a linked person only its own account and no account', () => {
    expect(personnelUserPickerRule(true, '7')).toEqual({ locked: false, onlyStored: true, hint: PERSONNEL_USER_RELINK_HINT });
  });

  it('offers every free account to a person without one', () => {
    expect(personnelUserPickerRule(true, '')).toEqual({ locked: false, onlyStored: false, hint: null });
  });
});
