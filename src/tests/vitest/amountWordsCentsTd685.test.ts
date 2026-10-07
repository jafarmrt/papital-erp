import { describe, expect, it } from 'vitest';
import { financialAmountToPersianWords } from '../../utils';

describe('TD-685 amount in words keeps the cents of a foreign currency', () => {
  it('12.5 dollars is twelve dollars and fifty cents', () => {
    expect(financialAmountToPersianWords(12.5, 'USD').words).toBe('دوازده دلار و پنجاه سنت');
  });

  it('cents only, other currencies and whole amounts', () => {
    expect(financialAmountToPersianWords(0.75, 'EUR').words).toBe('هفتاد و پنج سنت');
    expect(financialAmountToPersianWords('۱۰۰٫۰۵', 'AED').words).toBe('صد درهم و پنج فلس');
    expect(financialAmountToPersianWords(1000, 'USD').words).toBe('یک هزار دلار');
    expect(financialAmountToPersianWords(-2.1, 'GBP').words).toBe('منفی دو پوند و ده پنی');
  });

  it('rial amounts are unchanged', () => {
    expect(financialAmountToPersianWords(45000000, 'IRR').words).toBe('چهل و پنج میلیون ریال');
  });
});
