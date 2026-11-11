// v12 phase 8a (site review 2.12): the robot trap of the forms that make something in the ERP, as a pure function
import { describe, expect, it } from 'vitest';
import { STAMP_EXPIRED, TRAP_REFUSED, formStamp, keptStamp, trapRefusal } from '../app/lib/botTrap.server';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const T0 = 1_762_000_000_000;
const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
};

describe('the robot trap', () => {
  it('lets a person through: a stamp of this server, old enough, and the hidden field empty', () => {
    const form = formOf({ formAt: formStamp(T0, KEY), contact_website: '' });
    expect(trapRefusal(form, T0 + 5_000, KEY, 3_000)).toBeNull();
  });

  it('refuses a form whose hidden field is filled, whatever its stamp', () => {
    const form = formOf({ formAt: formStamp(T0, KEY), contact_website: 'https://spam.example' });
    expect(trapRefusal(form, T0 + 60_000, KEY, 3_000)).toBe(TRAP_REFUSED);
  });

  it('refuses a form sent sooner than the minimum after its page was made', () => {
    const form = formOf({ formAt: formStamp(T0, KEY) });
    expect(trapRefusal(form, T0 + 1_000, KEY, 3_000)).toBe(TRAP_REFUSED);
    expect(trapRefusal(form, T0 + 3_000, KEY, 3_000)).toBeNull();
  });

  it('refuses a missing, garbled, forged or day-old stamp', () => {
    expect(trapRefusal(formOf({}), T0, KEY, 0)).toBe(STAMP_EXPIRED);
    expect(trapRefusal(formOf({ formAt: 'not-a-stamp' }), T0, KEY, 0)).toBe(STAMP_EXPIRED);
    // an older time written by hand with another key's signature: the robot cannot sign
    expect(trapRefusal(formOf({ formAt: formStamp(T0 - 60_000, OTHER_KEY) }), T0, KEY, 3_000)).toBe(STAMP_EXPIRED);
    const [at, signature] = formStamp(T0, KEY).split('.');
    expect(trapRefusal(formOf({ formAt: `${Number(at) - 60_000}.${signature}` }), T0, KEY, 3_000)).toBe(STAMP_EXPIRED);
    expect(trapRefusal(formOf({ formAt: formStamp(T0, KEY) }), T0 + 25 * 3600_000, KEY, 3_000)).toBe(STAMP_EXPIRED);
  });

  it('keeps the stamp sent while it is good, so fixing a field is never too fast, and gives a fresh one otherwise', () => {
    const sent = formStamp(T0, KEY);
    expect(keptStamp(formOf({ formAt: sent }), T0 + 2_000, KEY)).toBe(sent);
    expect(keptStamp(formOf({ formAt: formStamp(T0, OTHER_KEY) }), T0 + 2_000, KEY)).toBe(formStamp(T0 + 2_000, KEY));
    expect(keptStamp(formOf({ formAt: sent }), T0 + 25 * 3600_000, KEY)).toBe(formStamp(T0 + 25 * 3600_000, KEY));
  });
});
