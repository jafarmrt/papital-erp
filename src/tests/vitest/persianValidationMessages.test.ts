/**
 * v9.0.60 (TD-529, B02-14): every 400 validation message is Persian and says what to change. Before, the default Zod
 * messages were English ("Invalid input: expected string, received undefined") and only the field name was translated.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { validate } from '../../middleware/validate';

async function messageFor(schema: z.ZodType, input: { body?: unknown; query?: unknown; params?: unknown }): Promise<{ status: number; message: string; issues: string[] }> {
  const req = { body: input.body ?? {}, query: input.query ?? {}, params: input.params ?? {} } as unknown as Request;
  return new Promise((resolve, reject) => {
    let status = 200;
    const res = {
      status(code: number) { status = code; return res; },
      json(body: { message: string; details: { issues: Array<{ message: string }> } }) {
        resolve({ status, message: body.message, issues: body.details.issues.map(i => i.message) });
        return res;
      },
    } as unknown as Response;
    validate(schema)(req, res, (err?: unknown) => (err ? reject(err) : resolve({ status: 200, message: '', issues: [] })));
  });
}

/** Latin letters left after removing raw field names shown in «» */
const latinOutsideFieldNames = (text: string) => text.replace(/«[^»]*»/g, '').match(/[A-Za-z]+/g) ?? [];

const login = z.object({ body: z.object({ username: z.string(), password: z.string() }) });
const user = z.object({ body: z.object({ username: z.string().trim().min(3), password: z.string().min(6), role: z.string() }) });
const mixed = z.object({
  body: z.object({
    quantity: z.number().int().positive(),
    price: z.number().max(1000),
    status: z.enum(['draft', 'final']),
    email: z.string().email(),
    items: z.array(z.object({ itemId: z.number() })).min(1),
    amount: z.union([z.number(), z.string()]),
    discountCode: z.string(),
    notes: z.string().max(5),
  }).strict(),
});

describe('TD-529 Persian validation messages', () => {
  it('an empty login says which fields to fill, in Persian', async () => {
    const r = await messageFor(login, { body: {} });
    expect(r.status).toBe(400);
    expect(r.issues).toEqual(['نام کاربری را وارد کنید', 'رمز عبور را وارد کنید']);
    expect(latinOutsideFieldNames(r.message)).toEqual([]);
  });

  it('wrong types and lengths name the fix with Persian digits', async () => {
    const r = await messageFor(user, { body: { username: 'ab', password: 12345678, role: 'accountant' } });
    expect(r.issues).toEqual(['نام کاربری باید دست‌کم ۳ نویسه باشد', 'رمز عبور باید متن باشد']);
    const short = await messageFor(user, { body: { username: 'abcd', password: '123', role: 'x' } });
    expect(short.issues).toEqual(['رمز عبور باید دست‌کم ۶ نویسه باشد']);
  });

  it('no message has Latin text except a raw untranslated field name', async () => {
    const r = await messageFor(mixed, { body: {
      quantity: -1, price: 5000, status: 'open', email: 'not-mail', items: [], amount: true, discountCode: 5, notes: 'longer text', extra: 1,
    } });
    expect(r.status).toBe(400);
    expect(r.issues.length).toBeGreaterThanOrEqual(8);
    for (const m of r.issues) expect(latinOutsideFieldNames(m), m).toEqual([]);
    expect(latinOutsideFieldNames(r.message)).toEqual([]);
    expect(r.issues).toContain('مقدار / تعداد باید بیشتر از ۰ باشد');
    expect(r.issues).toContain('یکی از گزینه‌های مجاز را برای وضعیت انتخاب کنید');
    expect(r.issues).toContain('«discountCode» باید متن باشد');
  });

  it('a message written by the schema itself is kept', async () => {
    const custom = z.object({ body: z.object({ password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد') }) });
    const r = await messageFor(custom, { body: { password: 'short' } });
    expect(r.issues).toEqual(['رمز عبور باید حداقل ۸ کاراکتر باشد']);
    expect(r.message).toBe('خطای اعتبارسنجی: رمز عبور باید حداقل ۸ کاراکتر باشد');
  });
});
