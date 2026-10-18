import http from 'node:http';
import https from 'node:https';
import {
  guardedDnsLookup, isLocalEchoTarget, isTestLoopbackOrigin, UNSAFE_RESOLVED_ADDRESS,
} from '../../lib/ssrfGuard.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import { APP_VERSION } from '../../lib/version.js';

/**
 * 10.2 package 8 (OBS-R2-81 part 4, TD-1296): the one way a webhook subscription's delivery and ping and an event rule's
 * webhook action reach another server. `assertSafeExternalUrl` checks the address before the request, but `fetch`
 * resolved the name again when it connected, so a name that answered a public address to the check and an inside one
 * to the socket (DNS rebinding) reached the inside address. Here the socket's own lookup is `guardedDnsLookup`, so every
 * address the connection may use is checked at connect time and an inside one refuses it before anything is sent
 * (hand-written on Node's http / https, no library, decision ت۴۰). A redirect is never followed: the 3xx answer comes
 * back to the caller, which records it as a failure, so a redirect to an inside address reaches nothing. Only this
 * server's echo simulator (test and development) and a test's own loopback origin connect without the check, as the
 * address guard already allows them. The answer is a standard `Response`, its body cut at
 * `WEBHOOK_RESPONSE_MAX_BYTES`.
 */

export const WEBHOOK_RESPONSE_MAX_BYTES = 64 * 1024;
export const CONNECT_TIME_UNSAFE_MESSAGE = 'نشانی مقصد هنگام اتصال به نشانی داخلی رسید و برای امنیت چیزی فرستاده نشد.';

export interface GuardedRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type WebhookTransport = (url: string, init: GuardedRequestInit) => Promise<Response>;

let testTransport: WebhookTransport | null = null;

/** a test's stand-in for the network (the partner site); refused outside `NODE_ENV=test` */
export function setWebhookTransportForTests(transport: WebhookTransport | null, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'test') throw new ForbiddenError('setWebhookTransportForTests is for tests only');
  testTransport = transport;
}

function abortError(): Error {
  const err = new Error('The request was aborted');
  err.name = 'AbortError';
  return err;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function responseHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

/**
 * review N-1: the headers `fetch` added on its own are kept: `Accept: *\/*` and a `User-Agent` (the caller's, else
 * `Papital-ERP/<version>`), so a partner site that filtered on them still receives the delivery
 */
export function webhookRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const names = new Set(Object.keys(headers).map(name => name.toLowerCase()));
  return {
    ...(names.has('accept') ? {} : { Accept: '*/*' }),
    ...(names.has('user-agent') ? {} : { 'User-Agent': `Papital-ERP/${APP_VERSION}` }),
    ...headers,
  };
}

export function guardedWebhookFetch(url: string, init: GuardedRequestInit): Promise<Response> {
  if (testTransport) return testTransport(url, { ...init, headers: webhookRequestHeaders(init.headers) });
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
  if (!transport) return Promise.reject(new Error(`Unsupported protocol ${target.protocol}`));
  const checked = !(isLocalEchoTarget(target) || isTestLoopbackOrigin(target));
  const body = init.body ?? '';

  return new Promise<Response>((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const req = transport.request(target, {
      method: init.method,
      headers: { ...webhookRequestHeaders(init.headers), 'Content-Length': String(Buffer.byteLength(body)) },
      agent: false,
      ...(checked ? { lookup: guardedDnsLookup as never } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const answer = () => finish(() => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          reject(new Error(`Unexpected HTTP status ${status}`));
          return;
        }
        resolve(new Response(NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks), {
          status, statusText: res.statusMessage ?? '', headers: responseHeaders(res.headers),
        }));
      });
      res.on('data', (chunk: Buffer) => {
        if (size >= WEBHOOK_RESPONSE_MAX_BYTES) return;
        const room = WEBHOOK_RESPONSE_MAX_BYTES - size;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        size += Math.min(chunk.length, room);
        if (size >= WEBHOOK_RESPONSE_MAX_BYTES) {
          answer();
          res.destroy();
        }
      });
      res.on('end', answer);
      res.on('error', (err) => finish(() => reject(err)));
    });
    const onAbort = () => {
      req.destroy(abortError());
    };
    init.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (err: NodeJS.ErrnoException) => finish(() => {
      if (err.name === 'AbortError') reject(err);
      else if (err.code === UNSAFE_RESOLVED_ADDRESS) reject(Object.assign(new Error(CONNECT_TIME_UNSAFE_MESSAGE), { code: UNSAFE_RESOLVED_ADDRESS }));
      else reject(err);
    }));
    req.end(body);
  });
}
