import { PassThrough } from 'node:stream';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter, type EntryContext } from 'react-router';
import { isbot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import { contentSecurityPolicy } from './lib/csp';
import { siteSeo } from './lib/seo.server';
import { shopInfo } from './lib/api.server';

/**
 * React Router's own server entry (as `react-router reveal` writes it), with one addition of phase 8.5: every page's
 * security policy is written here, so it allows the statistics service the owner chose (and nothing else from another site).
 * v12 phase 10a: and the picture of the e-namad seal, while the ERP's «اطلاعات فروشگاه» holds one.
 * v12 phase 10c: and a draft's preview (`/preview/<key>`) is sent as no page of the site whatever its answer is.
 */
export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  const [{ analytics }, shop] = await Promise.all([siteSeo(), shopInfo()]);
  responseHeaders.set('Content-Security-Policy', contentSecurityPolicy(analytics, shop.enamad?.imageUrl ?? ''));

  // The key of a preview link is in its address. When the preview's read fails (the ERP is down, the link has ended),
  // the page is the root's «پیدا نشد» or «در دسترس نیست» and the route's own headers are not used; the address is the
  // same, so the same three are written here by the matched route, for every answer.
  if (routerContext.staticHandlerContext.matches.some(match => match.route.id === 'routes/pagePreview')) {
    responseHeaders.set('Cache-Control', 'private, no-store');
    responseHeaders.set('X-Robots-Tag', 'noindex, nofollow');
    responseHeaders.set('Referrer-Policy', 'no-referrer');
  }

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') return new Response(null, { status: responseStatusCode, headers: responseHeaders });

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get('user-agent');
    // crawlers wait for the whole page
    const readyOption = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady';
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        const stream = createReadableStreamFromReadable(body);
        responseHeaders.set('Content-Type', 'text/html');
        pipe(body);
        resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) console.error(error);
      },
    });
  });
}
