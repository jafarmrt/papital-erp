// @vitest-environment node
/**
 * v10.0.85 (TD-1185): the route guard's 403 named the permission by its key («شما مجوز لازم (documents.delete) …»),
 * which the browser shows as a toast. The message now names the catalog's Persian title; the keys stay only in the
 * answer's `permissions` field (finding #7 of the user guide test).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/drizzle.js', () => ({ orm: {} }));
vi.mock('../../lib/memoryCache.js', () => ({ rolePermissionsCache: { getOrSet: async () => ({ permissions: [], isSystem: 0 }) } }));

import type { NextFunction, Request, Response } from 'express';
import { requirePermission } from '../../middleware/authorize';
import { permissionDefinition } from '../../lib/permissions/permissionCatalog';
import { permissionRequiredMessage } from '../../lib/permissions/permissionMessages';

const KEY_PATTERN = /\b[a-z_]+\.[a-z_]+\b/;
/** The Persian «or» that joins two permission titles in the message */
const OR = ' یا ';

async function refusalOf(...keys: string[]): Promise<{ status: number; body: { error: string; permissions?: string[] } }> {
  const guard = requirePermission(...keys);
  let status = 0;
  let body = { error: '' } as { error: string; permissions?: string[] };
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: typeof body) { body = payload; return this; },
  } as unknown as Response;
  await new Promise<void>(resolve => {
    const done = res.json.bind(res);
    (res as unknown as { json: (p: typeof body) => unknown }).json = (p: typeof body) => { done(p); resolve(); return res; };
    void guard({ user: { id: 7, role: 'clerk' } } as unknown as Request, res, (() => resolve()) as NextFunction);
  });
  return { status, body };
}

describe('permission_refusal_message_td_1185', () => {
  it('the guard refusal names the Persian permission title, not the key', async () => {
    const { status, body } = await refusalOf('documents.delete');
    expect(status).toBe(403);
    expect(body.error).toContain(`«${permissionDefinition('documents.delete')?.title}»`);
    expect(body.error).not.toMatch(KEY_PATTERN);
    expect(body.permissions).toEqual(['documents.delete']);
  });

  it('several keys are joined with the Persian or', () => {
    const message = permissionRequiredMessage(['documents.view', 'customers.view']);
    expect(message).toContain(`«${permissionDefinition('documents.view')?.title}»${OR}«${permissionDefinition('customers.view')?.title}»`);
    expect(message).not.toMatch(KEY_PATTERN);
  });
});
