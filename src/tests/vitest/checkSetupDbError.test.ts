// @vitest-environment node
/**
 * v10.0.210 (OBS-R1-14): `/check-setup` turned any database error into `isSetup: false`, so the login page of an
 * installed system opened the setup wizard while its database was briefly unreachable. It now answers a 503.
 */
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ fail: true }));

vi.mock('../../db/drizzle.js', () => {
  const chain = {
    from: () => chain,
    where: () => (state.fail ? Promise.reject(new Error('connection refused')) : Promise.resolve([{ count: 2 }])),
  };
  return { orm: { select: () => chain } };
});

import express from 'express';
import request from 'supertest';
import authRouter from '../../routes/auth.routes';
import { errorHandler } from '../../middleware/logger';
import { SETUP_STATE_UNREADABLE_MESSAGE } from '../../lib/auth/setupRules';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api', authRouter);
  server.use(errorHandler);
  return server;
}

describe('check_setup_db_error_obs_r1_14', () => {
  it('a database error is a 503 with a Persian message, never isSetup false', async () => {
    state.fail = true;
    const res = await request(app()).get('/api/check-setup');
    expect(res.status).toBe(503);
    expect(res.body.isSetup).toBeUndefined();
    expect(res.body.code).toBe('SETUP_STATE_UNREADABLE');
    expect(res.body.error).toBe(SETUP_STATE_UNREADABLE_MESSAGE);
  });
});
