// v12 phase 10 (the owner will use Matomo): a page a buyer moves to inside the site is told to Matomo. Before this the
// code looked for an array, and once `matomo.js` has loaded the queue is Matomo's own object, so no later page was counted.
import { describe, expect, it } from 'vitest';
import { matomoPageView } from '../app/components/Analytics';

const page = { url: 'https://shop.example/products?q=ring', title: 'محصولات | گالری پاپیتال', from: 'https://shop.example/' };
const commands = [
  ['setReferrerUrl', 'https://shop.example/'],
  ['setCustomUrl', 'https://shop.example/products?q=ring'],
  ['setDocumentTitle', 'محصولات | گالری پاپیتال'],
  ['trackPageView'],
  ['enableLinkTracking'],
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
    expect(calls).toEqual([1, 1, 1, 1, 1]);
  });

  it('does nothing when no queue is there', () => {
    for (const nothing of [undefined, null, 'x', 5, {}, { push: 'no' }]) expect(matomoPageView(nothing, page)).toBe(false);
  });
});
