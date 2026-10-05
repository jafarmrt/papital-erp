import { describe, expect, it } from 'vitest';
import { wcAuthQueryParams } from '../../services/woocommerce/wcRequestAuth';

// v8.0.114 (TD-408): کلید و رمز ووکامرس روی HTTPS فقط در هدر می‌روند، نه در query string
describe('wcAuthQueryParams', () => {
  it('keeps the consumer key and secret out of an HTTPS URL', () => {
    const params = wcAuthQueryParams('https://shop.example/wp-json/wc/v3/products', { sku: 'A1' }, 'ck_1', 'cs_1');
    expect(params).toEqual({ sku: 'A1' });
  });

  it('sends them in the query string only for plain HTTP', () => {
    const params = wcAuthQueryParams('http://127.0.0.1:8080/wp-json/wc/v3/products', { sku: 'A1' }, 'ck_1', 'cs_1');
    expect(params).toEqual({ sku: 'A1', consumer_key: 'ck_1', consumer_secret: 'cs_1' });
  });

  it('does not mutate the caller params', () => {
    const original = { page: 1 };
    wcAuthQueryParams('http://shop.local', original, 'k', 's');
    expect(original).toEqual({ page: 1 });
  });
});
