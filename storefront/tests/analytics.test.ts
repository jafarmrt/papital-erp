// v12 phase 10 (the owner will use Matomo): a page a buyer moves to inside the site is told to Matomo. Before this the
// code looked for an array, and once `matomo.js` has loaded the queue is Matomo's own object, so no later page was counted.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalyticsScripts, isLaterPage, matomoPageView, reportedAddress } from '../app/components/Analytics';

const page = { url: 'https://shop.example/products?q=ring', title: 'محصولات | گالری پاپیتال', from: 'https://shop.example/' };
const commands = [
  ['setReferrerUrl', 'https://shop.example/'],
  ['setCustomUrl', 'https://shop.example/products?q=ring'],
  ['setDocumentTitle', 'محصولات | گالری پاپیتال'],
  ['trackPageView'],
];

describe('telling Matomo of a page reached inside the site', () => {
  it('queues the view on the plain array of the setup script, before matomo.js has loaded', () => {
    const queue: unknown[][] = [['trackPageView']];
    expect(matomoPageView(queue, page)).toBe(true);
    expect(queue.slice(1)).toEqual(commands);
  });

  it('gives the view to the object matomo.js puts in the queue\'s place, one command a call', () => {
    // as matomo.js does: not an array, and `push` runs a command at once
    const taken: unknown[][] = [];
    const calls: number[] = [];
    const loaded = { push: (...given: unknown[][]) => { calls.push(given.length); taken.push(...given); } };
    expect(Array.isArray(loaded)).toBe(false);
    expect(matomoPageView(loaded, page)).toBe(true);
    expect(taken).toEqual(commands);
    expect(calls).toEqual([1, 1, 1, 1]);
  });

  it('does nothing when no queue is there', () => {
    for (const nothing of [undefined, null, 'x', 5, {}, { push: 'no' }]) expect(matomoPageView(nothing, page)).toBe(false);
  });

  it('tells a move once: not the first page of the document, and not the page already told', () => {
    expect(isLaterPage('', 'https://shop.example/')).toBe(false);
    expect(isLaterPage('https://shop.example/', 'https://shop.example/')).toBe(false);
    expect(isLaterPage('https://shop.example/', 'https://shop.example/products')).toBe(true);
    expect(isLaterPage('https://shop.example/products', 'https://shop.example/products?sort=newest')).toBe(true);
  });

  it('never reports the part of an address after #, which on the set-password page is the link\'s one-time key', () => {
    const at = { origin: 'https://shop.example', pathname: '/account/set-password', search: '', hash: '#pw_SECRET', href: 'https://shop.example/account/set-password#pw_SECRET' };
    expect(reportedAddress(at)).toBe('https://shop.example/account/set-password');
    expect(reportedAddress({ origin: 'https://shop.example', pathname: '/products', search: '?q=ring' })).toBe('https://shop.example/products?q=ring');
  });

  it('sets Matomo up to drop the part after # and to count the first page by the address and title it was drawn with', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsScripts, { config: { provider: 'matomo', id: '3', url: 'https://stats.example.com' } }));
    const start = html.indexOf('<script>') + '<script>'.length;
    const setup = html.slice(start, html.indexOf('</script>', start));
    const order = ['discardHashTag', 'setCustomUrl', 'setDocumentTitle', 'setTrackerUrl', 'setSiteId', 'trackPageView'].map(name => setup.indexOf(`['${name}'`));
    expect(order.every(at => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(setup).toContain("_paq.push(['discardHashTag',true]);");
    expect(setup).toContain("_paq.push(['setCustomUrl',location.origin+location.pathname+location.search]);");
    expect(setup).not.toContain('location.href');
    expect(setup).not.toContain('location.hash');
    expect(html).toMatch(/<script[^>]* src="https:\/\/stats\.example\.com\/matomo\.js"[^>]*><\/script>/);
  });
});
